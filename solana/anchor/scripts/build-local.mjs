import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anchor 1.2 defaults to sBPF v3. The installed Agave 3.1.10 local
// validator accepts the tested v0 build with existing platform-tools v1.52.
// Stage only source/config files, never existing wallets or deployment keys.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = await mkdtemp(join(tmpdir(), 'openfunds-build-'));
const compiler = join(homedir(), '.cache/solana/v1.52/platform-tools/rust/bin/rustc');
const sourceFiles = [
  'Anchor.toml', 'Cargo.toml', 'programs/openfunds/Cargo.toml',
  'programs/openfunds/src/lib.rs',
];
try {
  await access(compiler); // Fail if absent; do not install any toolchains.
  if (await access(join(root, 'Cargo.lock')).then(() => true, () => false)) {
    sourceFiles.push('Cargo.lock');
  }
  for (const file of sourceFiles) {
    await mkdir(dirname(join(stage, file)), { recursive: true });
    await copyFile(join(root, file), join(stage, file));
  }
  const args = [
    'build', '--ignore-keys', '--no-idl', '--arch', 'v0',
    '--tools-version', 'v1.52', '--', '--skip-tools-install', '--no-rustup-override',
  ];
  console.log(`anchor ${args.join(' ')}`);
  execFileSync('anchor', args, {
    cwd: stage, stdio: 'inherit', env: { ...process.env, RUSTC: compiler },
  });
  // Anchor forwards trailing build flags to IDL cargo test too. Generate the
  // IDL separately so SBF-specific flags never reach the host compiler.
  await mkdir(join(stage, 'target/idl'), { recursive: true });
  await mkdir(join(stage, 'target/types'), { recursive: true });
  execFileSync('anchor', [
    'idl', 'build', '-o', 'target/idl/openfunds.json', '-t', 'target/types/openfunds.ts',
  ], { cwd: stage, stdio: 'inherit' });
  for (const file of [
    'target/deploy/openfunds.so', 'target/idl/openfunds.json', 'target/types/openfunds.ts',
  ]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(stage, file), join(root, file));
  }
  // Keep the resolved dependencies stable on subsequent local builds.
  await copyFile(join(stage, 'Cargo.lock'), join(root, 'Cargo.lock'));
  console.log('PASS local build: sBPF v0 program and matching IDL/types ready');
} finally {
  await rm(stage, { recursive: true, force: true });
}
