import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import { SolanaAgentKit } from "../index";
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

/**
 * create a multisig token transfer proposal
 * @param agent SolanaAgentKit instance
 * @param multisigPda multisig address
 * @param vaultIndex index of the vault
 * @param to recipient address
 * @param amount amount to transfer
 * @param mint?  token mint address
 * @param memo? optional memo
 * @returns transaction index
 */

export async function createMultsigTransaction(
  agent: SolanaAgentKit,
  multisigPda: PublicKey,
  vaultIndex: number,
  to: PublicKey,
  amount: number,
  mint?: PublicKey,
  memo?: string,
): Promise<number> {
  try {
    const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
      agent.connection,
      multisigPda,
    );

    const currentTransactionIndex = Number(multisigInfo.transactionIndex);

    const newTransactionIndex = BigInt(currentTransactionIndex + 1);

    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: vaultIndex,
    });

    let tx;

    if (!mint) {
      // Transfer native SOL from vault
      const ix = SystemProgram.transfer({
        fromPubkey: vaultPda,
        toPubkey: to,
        lamports: amount * LAMPORTS_PER_SOL,
      });
      tx = new TransactionMessage({
        payerKey: vaultPda,
        instructions: [ix],
        recentBlockhash: (await agent.connection.getLatestBlockhash())
          .blockhash,
      });
    } else {
      // Transfer SPL token
      const fromAta = await getAssociatedTokenAddress(mint, vaultPda);
      const toAta = await getAssociatedTokenAddress(mint, to);

      // Get mint info to determine decimals
      const mintInfo = await getMint(agent.connection, mint);
      const adjustedAmount = amount * Math.pow(10, mintInfo.decimals);

      const ix = createTransferInstruction(
        fromAta,
        toAta,
        vaultPda,
        adjustedAmount,
      );

      tx = new TransactionMessage({
        payerKey: vaultPda,
        instructions: [ix],
        recentBlockhash: (await agent.connection.getLatestBlockhash())
          .blockhash,
      });
    }

    const signature = await multisig.rpc.vaultTransactionCreate({
      connection: agent.connection,
      feePayer: agent.wallet,
      multisigPda: multisigPda,
      transactionIndex: newTransactionIndex,
      creator: agent.wallet_address,
      vaultIndex,
      // what is this?
      ephemeralSigners: 0,
      transactionMessage: tx,
      memo: memo!,
    });

    await agent.connection.confirmTransaction(signature);

    const signature2 = await multisig.rpc.proposalCreate({
      connection: agent.connection,
      feePayer: agent.wallet,
      multisigPda: multisigPda,
      transactionIndex: newTransactionIndex,
      creator: agent.wallet,
    });

    await agent.connection.confirmTransaction(signature2);

    return Number(newTransactionIndex);
  } catch (error: any) {
    throw new Error(`Transfer failed: ${error.message}`);
  }
}
