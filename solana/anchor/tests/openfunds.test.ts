import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  AccountRole, address, createSolanaRpc, createTransactionMessage,
  isSolanaError, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM,
  generateKeyPairSigner, getAddressEncoder, getProgramDerivedAddress,
  getSignatureFromTransaction, getTransactionEncoder, pipe,
  appendTransactionMessageInstruction, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction, type InstructionWithSigners, type KeyPairSigner,
} from '@solana/kit';

type SignedInstruction = Omit<Instruction, 'accounts'> & InstructionWithSigners;

// RPC simulation errors wrap the precise program error in `cause`.
function isCustomProgramError(error: unknown, expectedCode: number): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    if (isSolanaError(error, SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM)) {
      return error.context.code === expectedCode;
    }
    error = error.cause;
  }
  return false;
}

// Standalone local harness: no Anchor provider wallet or keypair files are read.
test('OpenFunds legacy and unified V2 local flows', { timeout: 180_000 }, async (t) => {
  const root = resolve(import.meta.dirname, '..');
  const idl = JSON.parse(await readFile(join(root, 'target/idl/openfunds.json'), 'utf8'));
  const program = address(idl.address);
  const system = address('11111111111111111111111111111111');
  const programPath = join(root, 'target/deploy/openfunds.so');
  const ledger = await mkdtemp(join(tmpdir(), 'openfunds-local-'));
  const validator = spawn('solana-test-validator', [
    '--ledger', ledger, '--reset', '--rpc-port', '18899', '--faucet-port', '18910',
    '--bind-address', '127.0.0.1', '--bpf-program', program,
    programPath,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  let spawnError: Error | undefined;
  validator.on('error', error => { spawnError = error; });
  validator.stdout.on('data', chunk => { logs += chunk; });
  validator.stderr.on('data', chunk => { logs += chunk; });
  const rpc = createSolanaRpc('http://127.0.0.1:18899');
  const pause = () => new Promise(resolve => setTimeout(resolve, 200));
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      if (spawnError) throw spawnError;
      if (validator.exitCode !== null) throw new Error(`Validator exited: ${logs}`);
      try { await rpc.getLatestBlockhash().send(); ready = true; break; } catch { await pause(); }
    }
    assert.ok(ready, `Validator startup timed out: ${logs}`);

    // RPC readiness alone does not establish that the program was loaded.
    const { value: programAccount } = await rpc.getAccountInfo(program, {
      encoding: 'base64', commitment: 'confirmed',
    }).send();
    if (!programAccount || !programAccount.executable) {
      const programFileExists = await access(programPath).then(() => true, () => false);
      throw new Error([
        `OpenFunds program readiness failed: ${programAccount ? 'account is not executable' : 'account is missing'}`,
        `Program ID: ${program}`,
        `Program .so path: ${programPath}`,
        `Program .so exists: ${programFileExists}`,
        `Validator stdout/stderr:\n${logs}`,
      ].join('\n'));
    }

    // Allow newly loaded program code to become visible to the runtime.
    const startingSlot = await rpc.getSlot({ commitment: 'confirmed' }).send();
    let readySlot = startingSlot;
    for (let i = 0; i < 100 && readySlot < startingSlot + 2n; i++) {
      await pause();
      readySlot = await rpc.getSlot({ commitment: 'confirmed' }).send();
    }
    console.log(`Program slot readiness: start=${startingSlot}, end=${readySlot}, target=${startingSlot + 2n}`);
    assert.ok(readySlot >= startingSlot + 2n, 'Validator did not advance two confirmed slots');

    async function confirm(signature: Parameters<typeof rpc.getSignatureStatuses>[0][number]) {
      for (let i = 0; i < 100; i++) {
        const status = (await rpc.getSignatureStatuses([signature]).send()).value[0];
        if (status?.err) throw new Error(JSON.stringify(status.err));
        if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') return;
        await pause();
      }
      throw new Error('Transaction confirmation timed out');
    }
    const creator = await generateKeyPairSigner();
    const backer = await generateKeyPairSigner();
    const other = await generateKeyPairSigner();
    for (const signer of [creator, backer, other]) {
      await confirm(await rpc.requestAirdrop(signer.address, 2_000_000_000n as never).send());
    }
    const encoder = getAddressEncoder();
    async function pda(label: string, ...keys: Address[]) {
      return (await getProgramDerivedAddress({ programAddress: program,
        seeds: [Buffer.from(label), ...keys.map(key => encoder.encode(key))] }))[0];
    }
    const campaign = await pda('campaign', creator.address);
    const vault = await pda('vault', campaign);
    const contribution = await pda('contribution', campaign, backer.address);

    function instruction(name: string, signer: KeyPairSigner, keys: Address[], amount?: bigint): SignedInstruction {
      const definition = idl.instructions.find((ix: { name: string }) => ix.name === name);
      assert.ok(definition, `Missing IDL instruction ${name}`);
      const data = Buffer.alloc(amount === undefined ? 8 : 16);
      data.set(definition.discriminator);
      if (amount !== undefined) data.writeBigUInt64LE(amount, 8);
      return { programAddress: program, data, accounts: [
        { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
        ...keys.map(key => ({ address: key, role: AccountRole.WRITABLE })),
        { address: system, role: AccountRole.READONLY },
      ] };
    }
    async function send(ix: SignedInstruction, payer: KeyPairSigner, diagnose = true) {
      const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send();
      const message = pipe(createTransactionMessage({ version: 'legacy' }),
        message => setTransactionMessageFeePayerSigner(payer, message),
        message => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
        message => appendTransactionMessageInstruction(ix, message));
      const tx = await signTransactionMessageWithSigners(message);
      const encoded = Buffer.from(getTransactionEncoder().encode(tx)).toString('base64');
      try {
        await rpc.sendTransaction(encoded as never, { encoding: 'base64', preflightCommitment: 'confirmed' }).send();
        await confirm(getSignatureFromTransaction(tx));
        return getSignatureFromTransaction(tx);
      } catch (error) {
        if (!diagnose) throw error;
        const [programInfo, slot, programFileExists] = await Promise.allSettled([
          rpc.getAccountInfo(program, { encoding: 'base64', commitment: 'confirmed' }).send(),
          rpc.getSlot({ commitment: 'confirmed' }).send(),
          access(programPath).then(() => true, () => false),
        ]);
        const runtimeLog = await readFile(join(ledger, 'validator.log'), 'utf8').catch(() => 'Validator log unavailable');
        await writeFile(join(tmpdir(), 'openfunds-v2-validator.log'), runtimeLog);
        console.error(`Validator stdout/stderr:\n${logs}`);
        console.error(`Program ID: ${program}`);
        if (programInfo.status === 'fulfilled') {
          console.error(`Program account owner: ${programInfo.value.value?.owner ?? 'account missing'}`);
          console.error(`Executable flag: ${programInfo.value.value?.executable ?? 'account missing'}`);
        } else {
          console.error('Program account owner/executable lookup failed:', programInfo.reason);
        }
        console.error('Current slot:', slot.status === 'fulfilled' ? String(slot.value) : slot.reason);
        console.error(`Program .so path: ${programPath}`);
        console.error('Program .so exists:', programFileExists.status === 'fulfilled' ? programFileExists.value : programFileExists.reason);
        throw error;
      }
    }
    async function account(key: Address, name: string, size: number) {
      const { value } = await rpc.getAccountInfo(key, { encoding: 'base64', commitment: 'confirmed' }).send();
      assert.ok(value);
      assert.equal(value.owner, program);
      const data = Buffer.from(value.data[0], 'base64');
      assert.equal(data.length, size);
      const definition = idl.accounts.find((entry: { name: string }) => entry.name.toLowerCase() === name.toLowerCase());
      assert.ok(definition);
      assert.deepEqual([...data.subarray(0, 8)], definition.discriminator);
      return data;
    }
    const balance = async () => (await rpc.getBalance(vault, { commitment: 'confirmed' }).send()).value;
    const initialize = instruction('initialize_campaign', creator, [campaign, vault]);
    await send(initialize, creator);
    assert.deepEqual((await account(campaign, 'Campaign', 48)).subarray(8, 40), Buffer.from(encoder.encode(creator.address)));
    assert.equal((await account(campaign, 'Campaign', 48)).readBigUInt64LE(40), 0n);
    await account(vault, 'Vault', 8);
    await assert.rejects(send(initialize, creator));

    for (const expectedTotal of [10_000_000n, 20_000_000n]) {
      const before = await balance();
      await send(instruction('contribute', backer, [campaign, vault, contribution], 10_000_000n), backer);
      assert.equal(await balance() - before, 10_000_000n);
      assert.equal((await account(campaign, 'Campaign', 48)).readBigUInt64LE(40), expectedTotal);
      const record = await account(contribution, 'Contribution', 80);
      assert.deepEqual(record.subarray(8, 40), Buffer.from(encoder.encode(campaign)));
      assert.deepEqual(record.subarray(40, 72), Buffer.from(encoder.encode(backer.address)));
      assert.equal(record.readBigUInt64LE(72), expectedTotal);
    }
    // Valid accounts belonging to another creator/backer exercise seed constraints.
    const otherCampaign = await pda('campaign', other.address);
    const otherVault = await pda('vault', otherCampaign);
    await send(instruction('initialize_campaign', other, [otherCampaign, otherVault]), other);
    const otherContribution = await pda('contribution', campaign, other.address);
    await send(instruction('contribute', other, [campaign, vault, otherContribution], 1n), other);
    const beforeBalance = await balance();
    const beforeCampaign = await account(campaign, 'Campaign', 48);
    const beforeContribution = await account(contribution, 'Contribution', 80);
    for (const [keys, amount, errorCode] of [
      [[campaign, vault, contribution], 0n, 6000],
      [[otherCampaign, vault, contribution], 1n, 2006],
      [[campaign, otherVault, contribution], 1n, 2006],
      [[campaign, vault, otherContribution], 1n, 2006],
    ] as const) {
      await assert.rejects(send(instruction('contribute', backer, [...keys], amount), backer),
        error => isCustomProgramError(error, errorCode));
      assert.equal(await balance(), beforeBalance);
      assert.deepEqual(await account(campaign, 'Campaign', 48), beforeCampaign);
      assert.deepEqual(await account(contribution, 'Contribution', 80), beforeContribution);
    }
    // V2 shares project metadata and messages on chain, independently of a browser.
    const u64 = (value: bigint) => { const data = Buffer.alloc(8); data.writeBigUInt64LE(value); return data; };
    const text = (value: string) => { const body = Buffer.from(value, 'utf8'); const length = Buffer.alloc(4); length.writeUInt32LE(body.length); return Buffer.concat([length, body]); };
    async function v2Pda(label: string, key: Address, identifier?: bigint) {
      return (await getProgramDerivedAddress({ programAddress: program,
        seeds: [Buffer.from(label), encoder.encode(key), ...(identifier === undefined ? [] : [u64(identifier)])] }))[0];
    }
    function ix(name: string, signer: KeyPairSigner, keys: Address[], args: Uint8Array[] = [], systemAccount = false): SignedInstruction {
      const definition = idl.instructions.find((item: { name: string }) => item.name === name);
      assert.ok(definition, `Missing instruction ${name}`);
      return { programAddress: program, data: Buffer.concat([Buffer.from(definition.discriminator), ...args]), accounts: [
        { address: signer.address, role: AccountRole.WRITABLE_SIGNER, signer },
        ...keys.map(key => ({ address: key, role: AccountRole.WRITABLE })),
        ...(systemAccount ? [{ address: system, role: AccountRole.READONLY }] : []),
      ] };
    }
    const walletBalance = async (key: Address) => (await rpc.getBalance(key, { commitment: 'confirmed' }).send()).value;
    const snapshot = async (keys: Address[]) => Promise.all(keys.map(async key => {
      const info = (await rpc.getAccountInfo(key, { encoding: 'base64', commitment: 'confirmed' }).send()).value;
      return info ? { key, owner: info.owner, lamports: info.lamports, data: info.data } : { key, missing: true };
    }));
    async function unchangedFailure(instruction: SignedInstruction, signer: KeyPairSigner, keys: Address[], code?: number) {
      const before = await snapshot(keys);
      if (code === undefined) await assert.rejects(send(instruction, signer, false));
      else await assert.rejects(send(instruction, signer, false), error => isCustomProgramError(error, code));
      assert.deepEqual(await snapshot(keys), before, 'Rejected instruction changed campaign/vault/contribution state');
    }
    const platform = (await getProgramDerivedAddress({ programAddress: program, seeds: [Buffer.from('platform_v2')] }))[0];
    await t.test('V2 capability marker is canonical and initialized once', async () => {
      await send(ix('initialize_platform_v2', creator, [platform], [], true), creator);
      assert.equal((await account(platform, 'PlatformV2', 9))[8], 2);
      await unchangedFailure(ix('initialize_platform_v2', creator, [platform], [], true), creator, [platform]);
    });
    const projects = await Promise.all([1n, 2n, 3n].map(async id => {
      const key = await v2Pda('campaign_v2', creator.address, id);
      return { key, id, vault: await pda('vault_v2', key), contribution: await pda('contribution_v2', key, backer.address) };
    }));
    const otherProject = await v2Pda('campaign_v2', other.address, 1n);
    const otherProjectVault = await pda('vault_v2', otherProject);
    const initializeV2 = (signer: KeyPairSigner, key: Address, vaultKey: Address, id: bigint, title = `Project ${id}`, description = 'Shared project description', image = 'https://example.com/project.png', goal = 1_000_000_000n) =>
      ix('initialize_campaign_v2', signer, [key, vaultKey], [u64(id), u64(goal), text(title), text(description), text(image)], true);
    await t.test('Creator A creates three isolated projects and Creator B reuses identifier 1', async () => {
      for (const project of projects) {
        await send(initializeV2(creator, project.key, project.vault, project.id), creator);
        const state = await account(project.key, 'CampaignV2', 789);
        assert.deepEqual(state.subarray(8, 40), Buffer.from(encoder.encode(creator.address)));
        assert.equal(state.readBigUInt64LE(40), project.id);
        assert.equal(state.readBigUInt64LE(48), 1_000_000_000n);
        assert.equal(state.readBigUInt64LE(56), 0n);
        assert.equal(state.readBigUInt64LE(64), 0n);
        assert.equal(state[96], 0);
        assert.ok(state.readBigInt64LE(80) > 0n);
        assert.equal(state.subarray(101, 101 + state.readUInt32LE(97)).toString('utf8'), `Project ${project.id}`);
        await account(project.vault, 'VaultV2', 8);
      }
      assert.equal(new Set(projects.map(project => project.key)).size, 3);
      assert.equal(new Set(projects.map(project => project.vault)).size, 3);
      await send(initializeV2(other, otherProject, otherProjectVault, 1n), other);
      assert.notEqual(otherProject, projects[0].key);
      await unchangedFailure(initializeV2(creator, projects[0].key, projects[0].vault, 1n), creator, [projects[0].key, projects[0].vault]);
    });
    await t.test('Invalid UTF-8 metadata bounds, unsafe image URLs and zero goals roll back initialization', async () => {
      let id = 10n;
      for (const [title, description, image, goal, code] of [
        [' ', 'Description', '', 1n, 6004],
        ['я'.repeat(41), 'Description', '', 1n, 6004],
        ['Title', 'x'.repeat(401), '', 1n, 6004],
        ['Title', ' ', '', 1n, 6004],
        ['Title', 'Description', 'http://unsafe.example/image.png', 1n, 6004],
        ['Title', 'Description', '', 0n, 6003],
      ] as const) {
        const key = await v2Pda('campaign_v2', creator.address, id);
        const vaultKey = await pda('vault_v2', key);
        await unchangedFailure(initializeV2(creator, key, vaultKey, id, title, description, image, goal), creator, [key, vaultKey], code);
        id++;
      }
    });
    const primary = projects[0];
    const second = projects[1];
    const secondBacker = await generateKeyPairSigner();
    await confirm(await rpc.requestAirdrop(secondBacker.address, 2_000_000_000n as never).send());
    const secondContribution = await pda('contribution_v2', primary.key, secondBacker.address);
    const otherContributionV2 = await pda('contribution_v2', otherProject, other.address);
    const contributeV2 = (signer: KeyPairSigner, project: typeof primary, amount: bigint, contributionKey = project.contribution) =>
      ix('contribute_v2', signer, [project.key, project.vault, contributionKey], [u64(amount)], true);
    await t.test('Repeated exact contributions reuse one record and remain isolated by project', async () => {
      for (const expected of [10_000_000n, 20_000_000n]) {
        const before = await walletBalance(primary.vault);
        await send(contributeV2(backer, primary, 10_000_000n), backer);
        assert.equal(await walletBalance(primary.vault) - before, 10_000_000n);
        assert.equal((await account(primary.key, 'CampaignV2', 789)).readBigUInt64LE(56), expected);
        assert.equal((await account(primary.contribution, 'ContributionV2', 88)).readBigUInt64LE(72), expected);
      }
      await send(contributeV2(backer, second, 7_000_000n), backer);
      assert.notEqual(primary.contribution, second.contribution);
      assert.equal((await account(primary.key, 'CampaignV2', 789)).readBigUInt64LE(56), 20_000_000n);
      assert.equal((await account(second.key, 'CampaignV2', 789)).readBigUInt64LE(56), 7_000_000n);
      await send(contributeV2(secondBacker, primary, 30_000_000n, secondContribution), secondBacker);
      await send(ix('contribute_v2', other, [otherProject, otherProjectVault, otherContributionV2], [u64(1n)], true), other);
    });
    const primaryStateKeys = [primary.key, primary.vault, primary.contribution, secondContribution];
    await t.test('Zero amounts and substituted project/vault/contribution accounts fail without state changes', async () => {
      await unchangedFailure(contributeV2(backer, primary, 0n), backer, primaryStateKeys, 6000);
      for (const keys of [
        [otherProject, primary.vault, primary.contribution],
        [primary.key, otherProjectVault, primary.contribution],
        [primary.key, primary.vault, secondContribution],
      ]) await unchangedFailure(ix('contribute_v2', backer, keys, [u64(1n)], true), backer, primaryStateKeys, 2006);
      await unchangedFailure(contributeV2(backer, primary, 18_446_744_073_709_551_615n), backer, primaryStateKeys, 6002);
    });
    const message0 = await v2Pda('message_v2', primary.key, 0n);
    const message1 = await v2Pda('message_v2', primary.key, 1n);
    const creatorContribution = await pda('contribution_v2', primary.key, creator.address);
    const outsiderContribution = await pda('contribution_v2', primary.key, other.address);
    const message = (signer: KeyPairSigner, contributionKey: Address, index: bigint, messageKey: Address, body: string) =>
      ix('post_message_v2', signer, [primary.key, contributionKey, messageKey], [u64(index), text(body)], true);
    await t.test('Substituted V2 chat contribution and message PDAs reject without modifying any state', async () => {
      const keys = [...primaryStateKeys, second.key, second.vault, second.contribution, message0, message1];
      await unchangedFailure(message(backer, second.contribution, 0n, message0, 'Wrong contribution'), backer, keys, 2006);
      await unchangedFailure(message(backer, primary.contribution, 0n, message1, 'Wrong message PDA'), backer, keys, 2006);
    });
    await t.test('Shared immutable chat authenticates creator/backers and rejects outsiders, empty, oversized or stale messages', async () => {
      await send(message(creator, creatorContribution, 0n, message0, 'Привет, спонсоры!'), creator);
      const first = await account(message0, 'MessageV2', 332);
      assert.deepEqual(first.subarray(40, 72), Buffer.from(encoder.encode(creator.address)));
      assert.equal(first.readBigUInt64LE(72), 0n);
      assert.equal(first.subarray(92, 92 + first.readUInt32LE(88)).toString('utf8'), 'Привет, спонсоры!');
      const keys = [...primaryStateKeys, message0, message1];
      await unchangedFailure(message(other, outsiderContribution, 1n, message1, 'Unauthorized'), other, keys, 6006);
      await unchangedFailure(message(backer, primary.contribution, 1n, message1, ' '), backer, keys, 6009);
      await unchangedFailure(message(backer, primary.contribution, 1n, message1, 'я'.repeat(121)), backer, keys, 6009);
      const future = await v2Pda('message_v2', primary.key, 2n);
      await unchangedFailure(message(backer, primary.contribution, 2n, future, 'Wrong index'), backer, [...keys, future], 6010);
      await send(message(backer, primary.contribution, 1n, message1, 'Поддержал проект'), backer);
      assert.equal((await account(primary.key, 'CampaignV2', 789)).readBigUInt64LE(72), 2n);
      await unchangedFailure(message(creator, creatorContribution, 0n, message0, 'Overwrite'), creator, [...primaryStateKeys, message0]);
      assert.deepEqual(await account(message0, 'MessageV2', 332), first);
    });
    const refundV2 = (authority: KeyPairSigner, recipient: Address, contributionKey: Address, vaultKey = primary.vault) =>
      ix('refund_contribution_v2', authority, [primary.key, vaultKey, contributionKey, recipient]);
    await t.test('Only creator closes, refunds require closure and exact recorded recipients', async () => {
      await unchangedFailure(refundV2(creator, backer.address, primary.contribution), creator, primaryStateKeys, 6007);
      await unchangedFailure(ix('close_campaign_v2', other, [primary.key]), other, primaryStateKeys, 6006);
      await send(ix('close_campaign_v2', creator, [primary.key]), creator);
      const state = await account(primary.key, 'CampaignV2', 789);
      assert.equal(state[96], 1);
      assert.ok(state.readBigInt64LE(88) > 0n);
      await unchangedFailure(contributeV2(backer, primary, 1n), backer, primaryStateKeys, 6005);
      await unchangedFailure(ix('close_campaign_v2', creator, [primary.key]), creator, primaryStateKeys, 6005);
      await unchangedFailure(refundV2(other, backer.address, primary.contribution), other, primaryStateKeys, 6006);
      await unchangedFailure(refundV2(creator, other.address, primary.contribution), creator, primaryStateKeys);
      await unchangedFailure(refundV2(creator, backer.address, primary.contribution, otherProjectVault), creator, primaryStateKeys, 2006);
      await unchangedFailure(refundV2(creator, backer.address, second.contribution), creator, primaryStateKeys);
    });
    await t.test('Creator returns exact funds to backer A; backer B can claim; double refunds fail and history remains', async () => {
      const reserve = (await rpc.getMinimumBalanceForRentExemption(8n).send());
      const beforeA = await walletBalance(backer.address);
      const beforeVault = await walletBalance(primary.vault);
      await send(refundV2(creator, backer.address, primary.contribution), creator);
      assert.equal(await walletBalance(backer.address) - beforeA, 20_000_000n);
      assert.equal(beforeVault - await walletBalance(primary.vault), 20_000_000n);
      assert.equal((await account(primary.contribution, 'ContributionV2', 88)).readBigUInt64LE(80), 20_000_000n);
      await unchangedFailure(refundV2(creator, backer.address, primary.contribution), creator, primaryStateKeys, 6008);
      const beforeB = await walletBalance(secondBacker.address);
      await send(refundV2(secondBacker, secondBacker.address, secondContribution), secondBacker);
      assert.equal(await walletBalance(secondBacker.address) - beforeB, 30_000_000n - 5_000n);
      assert.equal(await walletBalance(primary.vault), reserve);
      const state = await account(primary.key, 'CampaignV2', 789);
      assert.equal(state.readBigUInt64LE(56), 50_000_000n);
      assert.equal(state.readBigUInt64LE(64), 50_000_000n);
      assert.equal(state[96], 2);
      await account(message0, 'MessageV2', 332);
      assert.equal((await account(second.key, 'CampaignV2', 789)).readBigUInt64LE(56), 7_000_000n);
    });
    await t.test('Empty project closes immediately without erasing its metadata', async () => {
      await send(ix('close_campaign_v2', creator, [projects[2].key]), creator);
      assert.equal((await account(projects[2].key, 'CampaignV2', 789))[96], 2);
    });
    const legacyDiscussion = await pda('legacy_discussion', campaign);
    const legacyMessage0 = await v2Pda('message_v2', campaign, 0n);
    const legacyMessage1 = await v2Pda('message_v2', campaign, 1n);
    const legacyMessage2 = await v2Pda('message_v2', campaign, 2n);
    const creatorLegacyContribution = await pda('contribution', campaign, creator.address);
    const outsiderLegacyContribution = await pda('contribution', campaign, secondBacker.address);
    const legacyMessage = (author: KeyPairSigner, authorContribution: Address, index: bigint, messageKey: Address, body: string) =>
      ix('post_message_legacy', author, [campaign, authorContribution, legacyDiscussion, messageKey], [u64(index), text(body)], true);
    await t.test('Substituted legacy chat contribution and message PDAs fail without changing its counter or project funds', async () => {
      const keys = [campaign, vault, contribution, otherContribution, legacyDiscussion, legacyMessage0, legacyMessage1];
      await unchangedFailure(legacyMessage(backer, otherContribution, 0n, legacyMessage0, 'Wrong contribution'), backer, keys, 2006);
      await unchangedFailure(legacyMessage(backer, contribution, 0n, legacyMessage1, 'Wrong message PDA'), backer, keys, 2006);
    });
    await t.test('Existing funded legacy projects share authenticated chat without changing the Campaign prefix', async () => {
      const prefix = await account(campaign, 'Campaign', 48);
      await send(legacyMessage(creator, creatorLegacyContribution, 0n, legacyMessage0, 'Legacy project update'), creator);
      const discussion = await account(legacyDiscussion, 'LegacyDiscussion', 48);
      assert.deepEqual(discussion.subarray(8, 40), Buffer.from(encoder.encode(campaign)));
      assert.equal(discussion.readBigUInt64LE(40), 1n);
      const first = await account(legacyMessage0, 'MessageV2', 332);
      assert.deepEqual(first.subarray(8, 40), Buffer.from(encoder.encode(campaign)));
      assert.deepEqual(first.subarray(40, 72), Buffer.from(encoder.encode(creator.address)));
      const keys = [campaign, vault, contribution, legacyDiscussion, legacyMessage0, legacyMessage1, legacyMessage2];
      await unchangedFailure(legacyMessage(secondBacker, outsiderLegacyContribution, 1n, legacyMessage1, 'Outsider'), secondBacker, keys, 6006);
      await unchangedFailure(legacyMessage(backer, contribution, 1n, legacyMessage1, ' '), backer, keys, 6009);
      await unchangedFailure(legacyMessage(backer, contribution, 1n, legacyMessage1, 'я'.repeat(121)), backer, keys, 6009);
      await unchangedFailure(legacyMessage(backer, contribution, 2n, legacyMessage2, 'Skipped index'), backer, keys, 6010);
      await send(legacyMessage(backer, contribution, 1n, legacyMessage1, 'Sponsor reply'), backer);
      assert.equal((await account(legacyDiscussion, 'LegacyDiscussion', 48)).readBigUInt64LE(40), 2n);
      await unchangedFailure(legacyMessage(creator, creatorLegacyContribution, 0n, legacyMessage0, 'Overwrite'), creator, keys);
      assert.deepEqual(await account(legacyMessage0, 'MessageV2', 332), first);
      assert.deepEqual(await account(campaign, 'Campaign', 48), prefix);
    });
    await t.test('Closed V2 discussion remains readable and rejects new posts', async () => {
      const key = await v2Pda('message_v2', primary.key, 2n);
      await unchangedFailure(message(creator, creatorContribution, 2n, key, 'Closed post'), creator, [...primaryStateKeys, message0, message1, key], 6005);
      await account(message0, 'MessageV2', 332);
      await account(message1, 'MessageV2', 332);
    });

    const closure = await pda('legacy_close', campaign);
    const legacyReceiptA = await pda('legacy_refund', campaign, backer.address);
    const legacyReceiptB = await pda('legacy_refund', campaign, other.address);
    const closeLegacy = (signer: KeyPairSigner) => ix('close_campaign_legacy', signer, [campaign, vault, closure], [], true);
    const refundLegacy = (authority: KeyPairSigner, recipient: Address, contributionKey: Address, receiptKey: Address, vaultKey = vault) =>
      ix('refund_contribution_legacy', authority, [campaign, vaultKey, contributionKey, closure, receiptKey, recipient], [], true);
    await t.test('Legacy closure preserves original ABI and blocks even an old contribute call without auxiliary accounts', async () => {
      const prefix = await account(campaign, 'Campaign', 48);
      await unchangedFailure(closeLegacy(other), other, [campaign, vault, contribution, closure], 6006);
      await send(closeLegacy(creator), creator);
      const state = await account(campaign, 'Campaign', 49);
      assert.deepEqual(state.subarray(0, 48), prefix);
      assert.equal(state[48], 1);
      assert.equal((await account(closure, 'LegacyClosure', 89))[80], 1);
      await unchangedFailure(sendAsOldContribute(), backer, [campaign, vault, contribution, closure], 6005);
      function sendAsOldContribute() { return instruction('contribute', backer, [campaign, vault, contribution], 1n); }
      await unchangedFailure(closeLegacy(creator), creator, [campaign, vault, contribution, closure]);
    });
    await t.test('Closed legacy discussion retains its shared history and rejects new posts', async () => {
      await unchangedFailure(legacyMessage(creator, creatorLegacyContribution, 2n, legacyMessage2, 'Closed legacy post'), creator,
        [campaign, vault, legacyDiscussion, legacyMessage0, legacyMessage1, legacyMessage2], 6005);
      assert.equal((await account(legacyDiscussion, 'LegacyDiscussion', 48)).readBigUInt64LE(40), 2n);
      await account(legacyMessage0, 'MessageV2', 332);
      await account(legacyMessage1, 'MessageV2', 332);
    });
    await t.test('Legacy exact refunds preserve contributed totals, enforce authority/recipients, and reject duplicate refunds', async () => {
      const keys = [campaign, vault, contribution, otherContribution, closure, legacyReceiptA, legacyReceiptB];
      await unchangedFailure(refundLegacy(secondBacker, backer.address, contribution, legacyReceiptA), secondBacker, keys, 6006);
      await unchangedFailure(refundLegacy(creator, other.address, contribution, legacyReceiptA), creator, keys);
      await unchangedFailure(refundLegacy(creator, backer.address, contribution, legacyReceiptA, otherVault), creator, keys, 2006);
      const originalContribution = await account(contribution, 'Contribution', 80);
      const beforeA = await walletBalance(backer.address);
      await send(refundLegacy(creator, backer.address, contribution, legacyReceiptA), creator);
      assert.equal(await walletBalance(backer.address) - beforeA, 20_000_000n);
      assert.deepEqual(await account(contribution, 'Contribution', 80), originalContribution);
      assert.equal((await account(legacyReceiptA, 'LegacyRefundReceipt', 80)).readBigUInt64LE(72), 20_000_000n);
      await unchangedFailure(refundLegacy(creator, backer.address, contribution, legacyReceiptA), creator, keys, 6008);
      const beforeB = await walletBalance(other.address);
      await send(refundLegacy(creator, other.address, otherContribution, legacyReceiptB), creator);
      assert.equal(await walletBalance(other.address) - beforeB, 1n);
      assert.equal((await account(closure, 'LegacyClosure', 89)).readBigUInt64LE(72), 20_000_001n);
      assert.equal((await account(closure, 'LegacyClosure', 89))[80], 2);
      assert.equal((await account(campaign, 'Campaign', 49)).readBigUInt64LE(40), 20_000_001n);
      assert.equal(await walletBalance(vault), await rpc.getMinimumBalanceForRentExemption(8n).send());
    });
    await t.test('Direct vault transfers are excluded from contribution accounting and refunds preserve the donation plus rent', async () => {
      const key = await v2Pda('campaign_v2', creator.address, 4n);
      const donationProject = { key, id: 4n, vault: await pda('vault_v2', key), contribution: await pda('contribution_v2', key, backer.address) };
      await send(initializeV2(creator, key, donationProject.vault, 4n), creator);
      await send(contributeV2(backer, donationProject, 10_000_000n), backer);
      const recordedCampaign = await account(key, 'CampaignV2', 789);
      const recordedContribution = await account(donationProject.contribution, 'ContributionV2', 88);
      const reserve = await rpc.getMinimumBalanceForRentExemption(8n).send();
      const donation = 1_234_567n;
      const beforeVault = await walletBalance(donationProject.vault);
      const transfer = Buffer.alloc(12);
      transfer.writeUInt32LE(2, 0);
      transfer.writeBigUInt64LE(donation, 4);
      await send({ programAddress: system, data: transfer, accounts: [
        { address: other.address, role: AccountRole.WRITABLE_SIGNER, signer: other },
        { address: donationProject.vault, role: AccountRole.WRITABLE },
      ] }, other);
      assert.equal(await walletBalance(donationProject.vault) - beforeVault, donation);
      assert.deepEqual(await account(key, 'CampaignV2', 789), recordedCampaign);
      assert.deepEqual(await account(donationProject.contribution, 'ContributionV2', 88), recordedContribution);
      await send(ix('close_campaign_v2', creator, [key]), creator);
      const beforeBacker = await walletBalance(backer.address);
      await send(ix('refund_contribution_v2', creator, [key, donationProject.vault, donationProject.contribution, backer.address]), creator);
      assert.equal(await walletBalance(backer.address) - beforeBacker, 10_000_000n);
      assert.equal(await walletBalance(donationProject.vault), reserve + donation);
      const refunded = await account(key, 'CampaignV2', 789);
      assert.equal(refunded.readBigUInt64LE(56), 10_000_000n);
      assert.equal(refunded.readBigUInt64LE(64), 10_000_000n);
      assert.equal(refunded[96], 2);
      await unchangedFailure(ix('refund_contribution_v2', creator, [key, donationProject.vault, donationProject.contribution, backer.address]), creator,
        [key, donationProject.vault, donationProject.contribution], 6008);
    });
    await t.test('Legacy sponsor self-claim refunds exact funds less its own fee and newly created receipt storage rent', async () => {
      const claimContribution = await pda('contribution', otherCampaign, secondBacker.address);
      const claimClosure = await pda('legacy_close', otherCampaign);
      const claimReceipt = await pda('legacy_refund', otherCampaign, secondBacker.address);
      const deposit = 12_000_000n;
      await send(instruction('contribute', secondBacker, [otherCampaign, otherVault, claimContribution], deposit), secondBacker);
      await send(ix('close_campaign_legacy', other, [otherCampaign, otherVault, claimClosure], [], true), other);
      const beforeBacker = await walletBalance(secondBacker.address);
      const beforeVault = await walletBalance(otherVault);
      const storageRent = await rpc.getMinimumBalanceForRentExemption(80n).send();
      const signature = await send(ix('refund_contribution_legacy', secondBacker,
        [otherCampaign, otherVault, claimContribution, claimClosure, claimReceipt, secondBacker.address], [], true), secondBacker);
      assert.ok(signature);
      const transaction = await rpc.getTransaction(signature, { encoding: 'json', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).send();
      assert.ok(transaction?.meta);
      const fee = BigInt(transaction.meta.fee);
      assert.equal(await walletBalance(secondBacker.address) - beforeBacker, deposit - fee - storageRent);
      assert.equal(beforeVault - await walletBalance(otherVault), deposit);
      assert.equal(await walletBalance(claimReceipt), storageRent);
      assert.equal((await account(claimReceipt, 'LegacyRefundReceipt', 80)).readBigUInt64LE(72), deposit);
      assert.equal((await account(claimClosure, 'LegacyClosure', 89)).readBigUInt64LE(72), deposit);
      assert.equal((await account(claimClosure, 'LegacyClosure', 89))[80], 2);
      assert.equal((await account(claimContribution, 'Contribution', 80)).readBigUInt64LE(72), deposit);
      assert.equal((await account(otherCampaign, 'Campaign', 49)).readBigUInt64LE(40), deposit);
      assert.equal(await walletBalance(otherVault), await rpc.getMinimumBalanceForRentExemption(8n).send());
      await unchangedFailure(ix('refund_contribution_legacy', secondBacker,
        [otherCampaign, otherVault, claimContribution, claimClosure, claimReceipt, secondBacker.address], [], true), secondBacker,
        [otherCampaign, otherVault, claimContribution, claimClosure, claimReceipt], 6008);
    });
  } finally {
    if (validator.exitCode === null && !spawnError) {
      const exited = new Promise<void>(resolve => validator.once('exit', () => resolve()));
      validator.kill('SIGTERM');
      await exited;
    }
    await rm(ledger, { recursive: true, force: true });
  }
});
