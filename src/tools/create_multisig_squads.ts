import { SolanaAgentKit } from "../index";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

const { Permission, Permissions } = multisig.types;

/**
 * Create a new multisig account
 * @param agent SolanaAgentKit instance
 * @param members Array of member accounts address with permissions (Vote, Initiate, Execute)
 * @param threshold Number of required votes to approve a transaction
 * @returns Transaction signature and multisig PDA
 */

export async function createMultsigAccount(
  agent: SolanaAgentKit,
  members: {
    address: string;
    permissions: ("Vote" | "Initiate" | "Execute")[];
  }[],
  threshold: number,
): Promise<{ signature: string; multisigPda: string }> {
  try {
    const createKey = Keypair.generate();

    // Derive the multisig account PDA
    const [multisigPda] = multisig.getMultisigPda({
      createKey: createKey.publicKey,
    });

    const programConfigPda = multisig.getProgramConfigPda({})[0];

    const programConfig =
      await multisig.accounts.ProgramConfig.fromAccountAddress(
        agent.connection,
        programConfigPda,
      );

    const configTreasury = programConfig.treasury;

    // Construct members array for multisig creation
    const multisigMembers = members.map((member) => ({
      key: new PublicKey(member.address),
      permissions: Permissions.fromPermissions(
        member.permissions.map((perm) => Permission[perm]),
      ),
    }));

    // Add the agent to the members list with full permissions
    multisigMembers.unshift({
      key: agent.wallet_address,
      permissions: Permissions.all(),
    });

    // Create the multisig
    const signature = await multisig.rpc.multisigCreateV2({
      connection: agent.connection,
      createKey,
      creator: agent.wallet,
      multisigPda,
      members: multisigMembers,
      threshold,
      configAuthority: null,
      timeLock: 0,
      rentCollector: agent.wallet_address,
      treasury: configTreasury,
    });
    await agent.connection.confirmTransaction(signature);

    return {
      signature,
      multisigPda: multisigPda.toString(),
    };
  } catch (error: any) {
    throw new Error(`Multisig creation failed: ${error.message}`);
  }
}
