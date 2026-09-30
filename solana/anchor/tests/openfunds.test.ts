import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  AccountRole, address, createSolanaRpc, createTransactionMessage,
  generateKeyPairSigner, getAddressEncoder, getProgramDerivedAddress,
  getSignatureFromTransaction, getTransactionEncoder, pipe,
  appendTransactionMessageInstruction, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners,
  type Address, type Instruction, type KeyPairSigner,
} from '@solana/kit';

// Standalone local harness: no Anchor provider wallet or keypair files are read.
test('OpenFunds local contribution flow', { timeout: 120_000 }, async () => {
  const root = resolve(import.meta.dirname, '..');
  const idl = JSON.parse(await readFile(join(root, 'target/idl/openfunds.json'), 'utf8'));
  const program = address(idl.address);
  const system = address('11111111111111111111111111111111');
  const programPath = join(root, 'target/deploy/openfunds.so');
  const ledger = await mkdtemp(join(tmpdir(), 'openfunds-local-'));
  const validator = spawn('solana-test-validator', [
    '--ledger', ledger, '--reset', '--rpc-port', '18899', '--faucet-port', '18900',
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

    function instruction(name: string, signer: KeyPairSigner, keys: Address[], amount?: bigint): Instruction {
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
    async function send(ix: Instruction, payer: KeyPairSigner) {
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
      } catch (error) {
        const [programInfo, slot, programFileExists] = await Promise.allSettled([
          rpc.getAccountInfo(program, { encoding: 'base64', commitment: 'confirmed' }).send(),
          rpc.getSlot({ commitment: 'confirmed' }).send(),
          access(programPath).then(() => true, () => false),
        ]);
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
    for (const [keys, amount, error] of [
      [[campaign, vault, contribution], 0n, /ZeroContribution|6000|0x1770/],
      [[otherCampaign, vault, contribution], 1n, /ConstraintSeeds|2006|0x7d6/],
      [[campaign, otherVault, contribution], 1n, /ConstraintSeeds|2006|0x7d6/],
      [[campaign, vault, otherContribution], 1n, /ConstraintSeeds|2006|0x7d6/],
    ] as const) {
      await assert.rejects(send(instruction('contribute', backer, [...keys], amount), backer), error);
      assert.equal(await balance(), beforeBalance);
      assert.deepEqual(await account(campaign, 'Campaign', 48), beforeCampaign);
      assert.deepEqual(await account(contribution, 'Contribution', 80), beforeContribution);
    }
  } finally {
    if (validator.exitCode === null && !spawnError) {
      const exited = new Promise<void>(resolve => validator.once('exit', () => resolve()));
      validator.kill('SIGTERM');
      await exited;
    }
    await rm(ledger, { recursive: true, force: true });
  }
});
