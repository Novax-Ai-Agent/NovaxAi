import { PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

/**
 * Get the vault address of a multisig
 * @param multisigPda Multisig address
 * @param vaultIndex vault index
 * @returns vault address as string
 */

export async function getMultisigVaultAddress(
  multisigPda: PublicKey,
  vaultIndex: number,
): Promise<string> {
  try {
    const [vaultPda] = multisig.getVaultPda({
      multisigPda,
      index: vaultIndex,
    });

    return vaultPda.toString();
  } catch (error: any) {
    throw new Error(`Transfer failed: ${error.message}`);
  }
}
