import { SolanaAgentKit } from "../index";
import { PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

/**
 * Vote on a multisig proposal
 * @param agent SolanaAgentKit instance
 * @param multisigPda Multisig address
 * @param transactionIndex Transaction index
 * @param approve Approve or reject the transaction
 * @returns Transaction signature
 */

// TODO how to reject a transaction?
export async function voteMultisigTransaction(
  agent: SolanaAgentKit,
  multisigPda: PublicKey,
  transactionIndex: number,
  approve: boolean,
): Promise<string> {
  try {
    if (approve) {
      const signature = await multisig.rpc.proposalApprove({
        connection: agent.connection,
        feePayer: agent.wallet,
        multisigPda,
        transactionIndex: BigInt(transactionIndex),
        member: agent.wallet,
      });
      await agent.connection.confirmTransaction(signature);
      return signature;
    } else {
      const signature = await multisig.rpc.proposalReject({
        connection: agent.connection,
        feePayer: agent.wallet,
        multisigPda,
        transactionIndex: BigInt(transactionIndex),
        member: agent.wallet,
      });
      await agent.connection.confirmTransaction(signature);
      return signature;
    }
  } catch (error: any) {
    throw new Error(`Transfer failed: ${error.message}`);
  }
}
