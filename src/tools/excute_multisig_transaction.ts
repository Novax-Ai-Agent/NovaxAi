import { SolanaAgentKit } from "../index";
import { PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

/**
 * Execute a multisig transaction
 * @param agent SolanaAgentKit instance
 * @param multisigPda Multisig address
 * @param transactionIndex Transaction index
 * @returns Transaction signature
 */

export async function excuteMultisigTransaction(
  agent: SolanaAgentKit,
  multisigPda: PublicKey,
  transactionIndex: number,
): Promise<string> {
  try {
    const signature = await multisig.rpc.vaultTransactionExecute({
      connection: agent.connection,
      feePayer: agent.wallet,
      multisigPda,
      transactionIndex: BigInt(transactionIndex),
      member: agent.wallet_address,
    });

    await agent.connection.confirmTransaction(signature);
    return signature;
  } catch (error: any) {
    throw new Error(`Transfer failed: ${error.message}`);
  }
}
