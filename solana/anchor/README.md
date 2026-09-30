# OpenFunds local milestone

Run from `solana/` in Ubuntu WSL with the installed Anchor, Solana and Node
executables on PATH:

```sh
npm run test:local
npm run typecheck:tests
```

`test:local` builds the program and IDL, then starts its own disposable validator
and generates signers in memory. No provider wallet or existing keypairs are read.
The temporary build folder and validator ledger are removed after use.
The validator uses RPC port 18899 and WebSocket/faucet port 18900; these must be free.

The installed combination is Anchor CLI / anchor-lang 1.2.0, Agave /
cargo-build-sbf 3.1.10, platform-tools v1.52, Node 24.10.0.
Anchor 1.2 defaults to sBPF v3. A fresh default build reproduced
`Program is not deployed / Unsupported program id` despite an executable program
account. The local build explicitly selects v0 and the already installed v1.52
compiler. It disables tool installation and rustup changes, stages only public
source/config files, and copies back only public artifacts and Cargo.lock.
The IDL is built separately because Anchor forwards trailing SBF flags to its
host `cargo test` command too. Use `npm run build:local` for this toolchain;
plain `anchor build` still uses Anchor's v3 default.

The test covers correct initialization and creator, zero initial total, two
10,000,000-lamport contributions using the same Contribution PDA, exact vault
deltas and both totals, zero contribution rejection, substituted Campaign/Vault/
Contribution rejection, and repeat initialization rejection. Negative cases are
checked in preflight and as confirmed failed transactions. Every involved PDA's
data and lamports must remain unchanged. Confirmed failed transactions still
charge the fee payer the network fee; preflight-rejected transactions do not.
An existing second creator/backer fixture is used only to test wrong PDA wiring.
