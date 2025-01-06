import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";
import {
  Connection,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  Transaction,
  TransactionError,
  TransactionSignature,
} from "@solana/web3.js";
import { SolanaAgentKit } from "../index";
import {
  TOKENS,
  DEFAULT_OPTIONS,
  DFLOW_SWAP_API,
  REFERRAL_PROGRAM_ADDRESS,
} from "../constants";
import { unpackMint } from "@solana/spl-token";
import { sleep } from "../utils/sleep";
import { assertUnreachable } from "../utils/coding";

export type TradeResult = {
  /** Address of the declarative swap order */
  orderAddress: string;
  /** Input quantity consumed */
  qtyIn: bigint;
  /** Output quantity */
  qtyOut: bigint;
  /** Number of decimals for the input mint */
  inputDecimals: number;
  /** Number of decimals for the output mint */
  outputDecimals: number;
};

/**
 * Swap tokens using DFlow
 * @param agent SolanaAgentKit instance
 * @param outputMint Target token mint address
 * @param inputAmount Amount to swap (in token decimals)
 * @param inputMint Source token mint address (defaults to USDC)
 * @param slippageBps Slippage tolerance in basis points (default: 300 = 3%)
 * @returns Trade result object containing details about the swap
 */

export async function trade(
  agent: SolanaAgentKit,
  outputMint: PublicKey,
  inputAmount: number,
  inputMint: PublicKey = TOKENS.USDC,
  slippageBps: number = DEFAULT_OPTIONS.SLIPPAGE_BPS,
): Promise<TradeResult> {
  try {
    const rpcEndpoint = agent.connection.rpcEndpoint;
    if (rpcEndpoint.includes("api.mainnet-beta.solana.com")) {
      throw new Error(
        `Cannot swap using RPC endpoint ${rpcEndpoint}. Please use a paid RPC endpoint.`,
      );
    }

    const [inputDecimals, outputDecimals] = await getDecimals(
      agent.connection,
      inputMint,
      outputMint,
    );

    // Calculate the correct amount based on actual decimals
    const scaledAmount = inputAmount * Math.pow(10, inputDecimals);

    let feeAccount;
    if (agent.config.JUPITER_REFERRAL_ACCOUNT) {
      [feeAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("referral_ata"),
          new PublicKey(agent.config.JUPITER_REFERRAL_ACCOUNT).toBuffer(),
          outputMint.toBuffer(),
        ],
        new PublicKey(REFERRAL_PROGRAM_ADDRESS),
      );
    }

    const intentResponse = await fetch(
      `${DFLOW_SWAP_API}/intent?` +
        `userPublicKey=${agent.wallet_address.toString()}` +
        `&inputMint=${inputMint.toString()}` +
        `&outputMint=${outputMint.toString()}` +
        `&amount=${scaledAmount}` +
        `&slippageBps=${slippageBps}` +
        `${agent.config.JUPITER_FEE_BPS ? `&platformFeeBps=${agent.config.JUPITER_FEE_BPS}` : ""}` +
        `${feeAccount ? `&feeAccount=${feeAccount}` : ""}` +
        `${agent.config.JUPITER_REFERRAL_ACCOUNT ? `&referralAccount=${agent.config.JUPITER_REFERRAL_ACCOUNT}` : ""}`,
    );
    if (!intentResponse.ok) {
      const msg = await parseApiError(intentResponse);
      throw new Error("Failed to fetch quote" + (msg ? `: ${msg}` : ""));
    }
    const intentData: Intent = await intentResponse.json();

    const openTransaction = Transaction.from(
      Buffer.from(intentData.openTransaction, "base64"),
    );
    openTransaction.sign(agent.wallet);

    const submitIntentResponse = await fetch(
      `${DFLOW_SWAP_API}/submit-intent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse: intentData,
          signedOpenTransaction: openTransaction.serialize().toString("base64"),
        }),
      },
    );
    if (!submitIntentResponse.ok) {
      const msg = await parseApiError(submitIntentResponse);
      throw new Error("Failed to submit intent" + (msg ? `: ${msg}` : ""));
    }
    const submitIntentData: SubmitIntentResponse =
      await submitIntentResponse.json();

    const result = await monitorOrder({
      connection: agent.connection,
      intent: intentData,
      signedOpenTransaction: openTransaction,
      submitIntentResponse: submitIntentData,
    });

    switch (result.status) {
      case "open_expired": {
        throw new Error("Transaction expired");
      }

      case "open_failed": {
        throw new Error("Transaction failed");
      }

      case "closed": {
        if (result.fills.length > 0) {
          const qtyIn = result.fills.reduce((acc, x) => acc + x.qtyIn, 0n);
          const qtyOut = result.fills.reduce((acc, x) => acc + x.qtyOut, 0n);
          return {
            orderAddress: submitIntentData.orderAddress,
            qtyIn,
            qtyOut,
            inputDecimals,
            outputDecimals,
          };
        } else {
          throw new Error("Order not filled");
        }
      }

      case "pending_close": {
        if (result.fills.length > 0) {
          const qtyIn = result.fills.reduce((acc, x) => acc + x.qtyIn, 0n);
          const qtyOut = result.fills.reduce((acc, x) => acc + x.qtyOut, 0n);
          return {
            orderAddress: submitIntentData.orderAddress,
            qtyIn,
            qtyOut,
            inputDecimals,
            outputDecimals,
          };
        } else {
          throw new Error("Order not filled");
        }
      }

      default: {
        assertUnreachable(result);
      }
    }
  } catch (error: any) {
    throw new Error(`Swap failed: ${error.message}`);
  }
}

async function getDecimals(
  connection: Connection,
  inputMint: PublicKey,
  outputMint: PublicKey,
): Promise<[number, number]> {
  let inputMintAccount, outputMintAccount;
  try {
    [inputMintAccount, outputMintAccount] =
      await connection.getMultipleAccountsInfo([inputMint, outputMint]);
  } catch {
    throw new Error("Failed to fetch mint accounts");
  }

  if (!inputMintAccount) {
    throw new Error("Invalid input mint");
  }
  if (!outputMintAccount) {
    throw new Error("Invalid output mint");
  }

  let inputDecimals;
  try {
    inputDecimals = unpackMint(inputMint, inputMintAccount).decimals;
  } catch {
    throw new Error("Invalid input mint");
  }

  let outputDecimals;
  try {
    outputDecimals = unpackMint(outputMint, outputMintAccount).decimals;
  } catch {
    throw new Error("Invalid output mint");
  }

  return [inputDecimals, outputDecimals];
}

type Intent = {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  platformFee: { amount: string; feeBps: number; feeAccount: string } | null;
  feeBudget: number;
  priceImpactPct: string;
  openTransaction: string;
  lastValidBlockHeight: number;
  expiry: { slotsAfterOpen: number };
};

type SubmitIntentResponse = {
  programId: string;
  orderAddress: string;
  openTransactionSignature: string;
};

const EVENT_INSTRUCTION_DISCRIMINATOR = Buffer.from([
  228, 69, 165, 46, 81, 203, 154, 29,
]);
const SWAP_EVENT_DISCRIMINATOR = Buffer.from([
  64, 198, 205, 232, 38, 8, 113, 226,
]);
const FEE_EVENT_DISCRIMINATOR = Buffer.from([
  73, 79, 78, 127, 184, 213, 13, 220,
]);

type MonitorOrderResult =
  | MonitorOrderResultOpenExpired
  | MonitorOrderResultOpenFailed
  | MonitorOrderResultClosed
  | MonitorOrderResultPendingClose;

/** Order opening transaction expired and was not included on chain */
type MonitorOrderResultOpenExpired = {
  status: "open_expired";
};

/** Order opening transaction was executed and failed */
type MonitorOrderResultOpenFailed = {
  status: "open_failed";
  transactionError: TransactionError | null;
};

/** Order was closed */
type MonitorOrderResultClosed = {
  status: "closed";
  fills: Fill[];
};

/** Order was opened but is no longer fillable and will be closed */
type MonitorOrderResultPendingClose = {
  status: "pending_close";
  fills: Fill[];
};

type Fill = {
  /** Fill transaction signature */
  signature: TransactionSignature;
  /** Input quantity consumed, after platform fee */
  qtyIn: bigint;
  /** Output quantity received, after platform fee */
  qtyOut: bigint;
  /** Platform fee for the fill, if any */
  platformFee?: PlatformFee | undefined;
};

type PlatformFee = {
  mint: PublicKey;
  qty: bigint;
};

async function monitorOrder(params: {
  connection: Connection;
  intent: Intent;
  signedOpenTransaction: Transaction;
  submitIntentResponse: SubmitIntentResponse;
}): Promise<MonitorOrderResult> {
  const {
    connection,
    intent,
    signedOpenTransaction: openTransaction,
    submitIntentResponse: {
      orderAddress,
      programId: swapOrchestratorProgramId,
    },
  } = params;
  const order = new PublicKey(orderAddress);
  const swapOrchestratorProgram = new PublicKey(swapOrchestratorProgramId);
  if (!openTransaction.signature) {
    throw new Error("Open transaction is not signed");
  }
  if (!openTransaction.recentBlockhash) {
    throw new Error("Open transaction does not have a recent blockhash");
  }
  const openTransactionSignature = bs58.encode(openTransaction.signature);

  // Subscribe to the open transaction signature and wait for it to be confirmed or expire
  const abortController1 = new AbortController();
  const openTxStatusCheckTask = subscribeToSignature(
    connection,
    openTransactionSignature,
    abortController1.signal,
  );
  const openTxExpiryCheckTask = waitForTransactionExpiry({
    transaction: openTransaction,
    lastValidBlockHeight: intent.lastValidBlockHeight,
    connection,
    abortSignal: abortController1.signal,
  });
  const monitorOpenResult = await Promise.any([
    openTxStatusCheckTask,
    openTxExpiryCheckTask,
  ]);
  let openTxSlot: number;
  if (monitorOpenResult.kind === "SubscribeToSignature") {
    if (monitorOpenResult.result.error) {
      return abortAndReturn(abortController1, {
        status: "open_failed",
        transactionError: monitorOpenResult.result.error,
      });
    }
    openTxSlot = monitorOpenResult.result.slot;
  } else {
    // The transaction expired before we received a confirmation notification. Try one last time to
    // get the transaction status in case the subscription was faulty and didn't notify us of the
    // confirmation.
    const expiredAsOfSlot = monitorOpenResult.slot;
    while (true) {
      try {
        const signaturesForAddress = await connection.getSignaturesForAddress(
          order,
          {
            minContextSlot: expiredAsOfSlot,
          },
        );
        const openTransaction = signaturesForAddress.find(
          (x) => x.signature === openTransactionSignature,
        );
        if (!openTransaction) {
          return abortAndReturn(abortController1, { status: "open_expired" });
        } else if (openTransaction.err) {
          return abortAndReturn(abortController1, {
            status: "open_failed",
            transactionError: openTransaction.err,
          });
        } else {
          openTxSlot = openTransaction.slot;
          break;
        }
      } catch {
        await sleep(10_000);
      }
    }
  }

  // At this point, the open transaction has been confirmed and succeeded
  abortController1.abort();

  // Poll the slot to determine whether the order is still fillable
  const pollSlotAbortController = new AbortController();
  const lastFillableSlot = openTxSlot + (intent.expiry?.slotsAfterOpen ?? 0);
  const isOrderExpiredRef = {
    value: false,
  };
  const getSignaturesForAddressMinContextSlotRef = {
    value: openTxSlot,
  };
  pollSlot(connection, pollSlotAbortController.signal, (slot) => {
    getSignaturesForAddressMinContextSlotRef.value = slot;
    if (slot > lastFillableSlot) {
      isOrderExpiredRef.value = true;
      // No need to continue polling after the order is no longer fillable
      pollSlotAbortController.abort();
    }
  });

  let orderSummary;
  let attemptsRemainingAfterExpiry = 3;
  while (attemptsRemainingAfterExpiry > 0) {
    try {
      const signatureInfos = await connection.getSignaturesForAddress(order, {
        minContextSlot: getSignaturesForAddressMinContextSlotRef.value,
      });

      if (isOrderExpiredRef.value) {
        attemptsRemainingAfterExpiry -= 1;
      }

      const openIndex = signatureInfos.findIndex(
        (x) => x.signature === openTransactionSignature,
      );
      if (openIndex === -1) {
        waitAfterGetSignaturesForAddress({
          isOrderExpired: isOrderExpiredRef.value,
        });
        continue;
      }

      const signaturesSinceAndIncludingOpen = signatureInfos
        .slice(0, openIndex + 1)
        .reverse();
      if (signaturesSinceAndIncludingOpen.length === 1) {
        // Only the open transaction has been processed
        waitAfterGetSignaturesForAddress({
          isOrderExpired: isOrderExpiredRef.value,
        });
        continue;
      }

      const successfulTransactions = await connection
        .getParsedTransactions(
          signaturesSinceAndIncludingOpen
            .filter((x) => !x.err)
            .map((x) => x.signature),
          {
            maxSupportedTransactionVersion: 1,
          },
        )
        .then((x) =>
          x.filter((tx): tx is ParsedTransactionWithMeta => tx !== null),
        );

      orderSummary = parseTransactions({
        intent,
        order,
        transactionsSinceOpen: successfulTransactions,
        swapOrchestratorProgram,
      });

      if (orderSummary.isClosed) {
        const fills = orderSummary.fills;
        return abortAndReturn(pollSlotAbortController, {
          status: "closed",
          fills,
        });
      }
      waitAfterGetSignaturesForAddress({
        isOrderExpired: isOrderExpiredRef.value,
      });
    } catch {
      waitAfterGetSignaturesForAddress({
        isOrderExpired: isOrderExpiredRef.value,
        isError: true,
      });
    }
  }

  const fills = orderSummary?.fills ?? [];
  return abortAndReturn(pollSlotAbortController, {
    status: "pending_close",
    fills,
  });
}

async function pollSlot(
  connection: Connection,
  abortSignal: AbortSignal,
  onSlot: (slot: number) => void,
): Promise<void> {
  const CHECK_INTERVAL_MILLIS = 10_000;
  while (true) {
    if (abortSignal.aborted) {
      return;
    }
    try {
      const slot = await connection.getSlot();
      try {
        onSlot(slot);
      } catch {
        // Ignore
      }
    } catch {
      // Ignore
    }
    if (abortSignal.aborted) {
      return;
    }
    await sleep(CHECK_INTERVAL_MILLIS);
  }
}

type OrderSummary = {
  fills: Fill[];
  isClosed: boolean;
};

function parseTransactions(params: {
  intent: Intent;
  order: PublicKey;
  transactionsSinceOpen: ParsedTransactionWithMeta[];
  swapOrchestratorProgram: PublicKey;
}): OrderSummary {
  const fills = [];
  let isClosed = false;
  for (const transaction of params.transactionsSinceOpen) {
    try {
      // A fill is any transaction that mentioned the order and emitted a SwapEvent
      const fill = parseFill({
        intent: params.intent,
        transaction: transaction,
        swapOrchestratorProgram: params.swapOrchestratorProgram,
      });
      fills.push(fill);
    } catch {
      // The transaction wasn't a fill
    }

    // The order was closed if there is a transaction that zeroed out its lamports
    const orderIndex = transaction.transaction.message.accountKeys.findIndex(
      (account) => account.pubkey.equals(params.order),
    );
    if (orderIndex === -1) {
      continue;
    }
    if (transaction.meta?.postBalances[orderIndex] === 0) {
      isClosed = true;
    }
  }

  return { fills, isClosed };
}

function parseFill(params: {
  intent: Intent;
  transaction: ParsedTransactionWithMeta;
  swapOrchestratorProgram: PublicKey;
}): Fill {
  const swapEvents: SwapEvent[] = [];
  const feeEvents: FeeEvent[] = [];

  const signature = params.transaction.transaction.signatures.at(0);
  if (!signature) {
    throw new Error("Transaction does not have a signature");
  }

  if (!params.transaction.meta?.innerInstructions) {
    throw new Error("Transaction does not have inner instructions");
  }

  const eventCpis = params.transaction.meta.innerInstructions.flatMap((ix) =>
    ix.instructions
      .filter(
        (innerIx): innerIx is PartiallyDecodedInstruction => "data" in innerIx,
      )
      .map((innerIx) => ({
        ...innerIx,
        decodedData: bs58.decode(innerIx.data),
      }))
      .filter((innerIx) => {
        return (
          innerIx.programId.equals(params.swapOrchestratorProgram) &&
          innerIx.decodedData.length >= 8 &&
          innerIx.decodedData
            .subarray(0, 8)
            .equals(EVENT_INSTRUCTION_DISCRIMINATOR)
        );
      }),
  );

  for (const eventCpi of eventCpis) {
    const eventDiscriminator = eventCpi.decodedData.subarray(8, 16);
    if (eventDiscriminator.equals(SWAP_EVENT_DISCRIMINATOR)) {
      const parsed = tryParseSwapEvent(eventCpi.decodedData);
      if (parsed !== null) {
        swapEvents.push(parsed);
      }
    } else if (eventDiscriminator.equals(FEE_EVENT_DISCRIMINATOR)) {
      const parsed = tryParseFeeEvent(eventCpi.decodedData);
      if (parsed !== null) {
        feeEvents.push(parsed);
      }
    }
  }

  if (swapEvents.length === 0) {
    throw new Error("Transaction did not emit any SwapEvents");
  }

  const platformFee =
    feeEvents.length === 0
      ? undefined
      : {
          mint: feeEvents[0].mint,
          qty: feeEvents.reduce((acc, x) => acc + x.amount, 0n),
        };

  const inputMint = new PublicKey(params.intent.inputMint);
  const outputMint = new PublicKey(params.intent.outputMint);
  const inputSwapEvents = swapEvents.filter((x) =>
    x.inputMint.equals(inputMint),
  );
  const outputSwapEvents = swapEvents.filter((x) =>
    x.outputMint.equals(outputMint),
  );
  let qtyIn = inputSwapEvents.reduce((acc, x) => acc + x.inputAmount, 0n);
  let qtyOut = outputSwapEvents.reduce((acc, x) => acc + x.outputAmount, 0n);
  if (platformFee) {
    if (platformFee.mint.equals(inputMint)) {
      qtyIn += platformFee.qty;
    }
    if (platformFee.mint.equals(outputMint)) {
      qtyOut -= platformFee.qty;
    }
  }

  return { signature, qtyIn, qtyOut, platformFee };
}

type SwapEvent = {
  amm: PublicKey;
  inputMint: PublicKey;
  inputAmount: bigint;
  outputMint: PublicKey;
  outputAmount: bigint;
};

function tryParseSwapEvent(eventData: Buffer): SwapEvent | null {
  try {
    const amm = new PublicKey(eventData.subarray(16, 16 + 32));
    const inputMint = new PublicKey(eventData.subarray(16 + 32, 16 + 64));
    const inputAmount = eventData.readBigUInt64LE(16 + 64);
    const outputMint = new PublicKey(eventData.subarray(16 + 72, 16 + 104));
    const outputAmount = eventData.readBigUInt64LE(16 + 104);
    return { amm, inputMint, inputAmount, outputMint, outputAmount };
  } catch {
    return null;
  }
}

type FeeEvent = {
  account: PublicKey;
  mint: PublicKey;
  amount: bigint;
};

function tryParseFeeEvent(eventData: Buffer): FeeEvent | null {
  try {
    const account = new PublicKey(eventData.subarray(16, 16 + 32));
    const mint = new PublicKey(eventData.subarray(16 + 32, 16 + 64));
    const amount = eventData.readBigUInt64LE(16 + 64);
    return { account, mint, amount };
  } catch {
    return null;
  }
}

async function waitAfterGetSignaturesForAddress(params: {
  isOrderExpired: boolean;
  isError?: true;
}) {
  if (params.isError) {
    await sleep(1_000);
  }

  if (params.isOrderExpired) {
    // Give the getSignaturesForAddress server a little more time to discover the transactions
    await sleep(2_000);
  } else {
    await sleep(250);
  }
}

type SubscribeToSignatureResult = {
  kind: "SubscribeToSignature";
  result: SignatureSubscribeResultProcessed;
};

type SignatureSubscribeResultProcessed = {
  isProcessed: true;
  slot: number;
  error: TransactionError | null;
};

type WaitForTransactionExpiryResult = {
  kind: "WaitForTransactionExpiry";
  /** The slot as of which the transaction was confirmed to have expired */
  slot: number;
};

type WaitForBlockhashToExpireResult = {
  kind: "WaitForBlockhashToExpire";
  slot: number;
};

function subscribeToSignature(
  connection: Connection,
  signature: TransactionSignature,
  abortSignal: AbortSignal,
): Promise<SubscribeToSignatureResult> {
  type SignatureSubscribeResult = {
    result:
      | SignatureSubscribeResultProcessed
      | SignatureSubscribeResultNotProcessed;
  };
  type SignatureSubscribeResultNotProcessed = {
    isProcessed: false;
  };

  const signatureSubscribeResult: SignatureSubscribeResult = {
    result: {
      isProcessed: false,
    },
  };

  const signatureSubscriptionId = connection.onSignature(
    signature,
    (signatureResult, context) => {
      if (signatureResult.err) {
        signatureSubscribeResult.result = {
          isProcessed: true,
          slot: context.slot,
          error: signatureResult.err,
        };
      } else {
        signatureSubscribeResult.result = {
          isProcessed: true,
          slot: context.slot,
          error: null,
        };
      }
    },
  );

  return new Promise<SubscribeToSignatureResult>((resolve, reject) => {
    const intervalId = setInterval(() => {
      if (signatureSubscribeResult.result.isProcessed) {
        clearInterval(intervalId);
        resolve({
          kind: "SubscribeToSignature",
          result: signatureSubscribeResult.result,
        });
      }

      if (abortSignal.aborted) {
        clearInterval(intervalId);
        connection
          .removeSignatureListener(signatureSubscriptionId)
          .catch(() => {});
        reject(new Error("The operation was aborted"));
      }
    }, 100);
  });
}

type WaitForTransactionExpiryParams = {
  transaction: Transaction;
  lastValidBlockHeight?: number;
  connection: Connection;
  abortSignal: AbortSignal;
};

async function waitForTransactionExpiry(
  params: WaitForTransactionExpiryParams,
): Promise<WaitForTransactionExpiryResult> {
  const { transaction, connection, abortSignal } = params;
  const lastValidBlockHeight =
    transaction.lastValidBlockHeight ?? params.lastValidBlockHeight;

  if (lastValidBlockHeight !== undefined) {
    await waitForBlockHeightToPass(
      lastValidBlockHeight,
      connection,
      abortSignal,
    );
  } else {
    // If the lastValidBlockHeight is unspecified, wait before starting to check for blockhash
    // expiry in case the RPC node serving the isBlockhashValid calls is lagging. If the RPC node is
    // lagging, it's possible it hasn't seen the transaction's recent blockhash yet, and in this
    // case, it would falsely report that the blockhash is invalid. Waiting here reduces the
    // likelihood that we encounter this issue.
    await sleep(10_000);
  }

  if (abortSignal.aborted) {
    return { kind: "WaitForTransactionExpiry", slot: 0 };
  }

  // Even though we know the transaction is already expired, we call this to get a slot as of which
  // the transaction is expired.
  const result = await waitForBlockhashToExpire(
    transaction,
    connection,
    abortSignal,
  );
  return { kind: "WaitForTransactionExpiry", slot: result.slot };
}

async function waitForBlockHeightToPass(
  targetBlockHeight: number,
  connection: Connection,
  abortSignal: AbortSignal,
): Promise<void> {
  const CHECK_INTERVAL_MILLIS = 10_000;
  while (true) {
    if (abortSignal.aborted) {
      return;
    }
    try {
      const blockHeight = await connection.getBlockHeight();
      if (blockHeight > targetBlockHeight) {
        return;
      }
    } catch (error) {
      console.error("getBlockHeight error:", error);
    }
    if (abortSignal.aborted) {
      return;
    }
    await sleep(CHECK_INTERVAL_MILLIS);
  }
}

async function waitForBlockhashToExpire(
  transaction: Transaction,
  connection: Connection,
  abortSignal: AbortSignal,
): Promise<WaitForBlockhashToExpireResult> {
  const CHECK_INTERVAL_MILLIS = 10_000;
  const blockhash = transaction.recentBlockhash;
  if (!blockhash) {
    throw new Error("Transaction doesn't have a recent blockhash");
  }
  while (true) {
    if (abortSignal.aborted) {
      return { kind: "WaitForBlockhashToExpire", slot: 0 };
    }
    try {
      const result = await connection.isBlockhashValid(blockhash);
      if (!result.value) {
        return { kind: "WaitForBlockhashToExpire", slot: result.context.slot };
      }
    } catch {
      // Ignore
    }
    if (abortSignal.aborted) {
      return { kind: "WaitForBlockhashToExpire", slot: 0 };
    }
    await sleep(CHECK_INTERVAL_MILLIS);
  }
}

function abortAndReturn<T>(abortController: AbortController, result: T): T {
  abortController.abort();
  return result;
}

async function parseApiError(response: Response): Promise<string | null> {
  try {
    const body = await response.text();
    try {
      const parsed = JSON.parse(body);
      if (parsed.msg) {
        return parsed.msg;
      } else {
        return body;
      }
    } catch {
      return body;
    }
  } catch {
    return null;
  }
}
