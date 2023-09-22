import { JsonRPCRequestDto } from '../dtos/json-rpc-request.dto';
import { RpcService } from '../services/rpc.service';
import { Helper } from '../../../common/helper';
import { USER_OPERATION_STATUS, UserOperationDocument } from '../schemas/user-operation.schema';
import { Contract } from 'ethers';
import entryPointAbi from './entry-point-abi';
import { TRANSACTION_STATUS } from '../schemas/transaction.schema';
import { BigNumber } from '../../../common/bignumber';
import { deepHexlify } from './utils';

export async function getUserOperationReceipt(rpcService: RpcService, chainId: number, body: JsonRPCRequestDto) {
    Helper.assertTrue(body.params.length === 1, -32602);
    Helper.assertTrue(typeof body.params[0] === 'string', -32602);

    const userOperationService = rpcService.aaService.userOperationService;
    const transactionService = rpcService.aaService.transactionService;

    const userOperation = await userOperationService.getUserOperationByHash(chainId, body.params[0]);
    if (!userOperation || userOperation.status === USER_OPERATION_STATUS.LOCAL) {
        return null;
    }

    if (userOperation.status === USER_OPERATION_STATUS.PENDING) {
        return await manuallyGetUserOperationReceipt(chainId, rpcService, userOperation);
    }

    const [transaction, userOperationEvent] = await Promise.all([
        transactionService.getTransaction(chainId, userOperation.txHash),
        userOperationService.getUserOperationEvent(chainId, userOperation.userOpHash),
    ]);

    if (!transaction || ![TRANSACTION_STATUS.FAILED, TRANSACTION_STATUS.SUCCESS].includes(transaction.status)) {
        return null;
    }

    const logs = [];
    for (const logItem of transaction.receipt.logs ?? []) {
        if (logItem.topics.includes(userOperation.userOpHash)) {
            logs.push(logItem);
        }
    }

    return deepHexlify({
        userOpHash: userOperation.userOpHash,
        sender: userOperation.userOpSender,
        nonce: BigNumber.from(userOperation.userOpNonce.toString()).toHexString(),
        actualGasCost: userOperationEvent?.args[5] ?? 0,
        actualGasUsed: userOperationEvent?.args[6] ?? 0,
        success: userOperationEvent?.args[4] ?? false,
        logs,
        receipt: transaction.receipt,
    });
}

export async function manuallyGetUserOperationReceipt(chainId: number, rpcService: RpcService, userOperation: UserOperationDocument) {
    try {
        const provider = rpcService.getJsonRpcProvider(chainId);
        const receipt: any = await rpcService.getTransactionReceipt(provider, userOperation.txHash);

        // failed transaction use local database value
        if (!receipt || BigNumber.from(receipt.status).toNumber() === 0) {
            return null;
        }

        const contract = new Contract(userOperation.entryPoint, entryPointAbi);
        const logs = [];
        let userOperationEvent: any;
        for (const log of receipt?.logs ?? []) {
            try {
                const parsed = contract.interface.parseLog(log);
                if (parsed?.name !== 'UserOperationEvent') {
                    continue;
                }

                if (parsed?.args?.userOpHash !== userOperation.userOpHash) {
                    continue;
                }

                logs.push(log);
                userOperationEvent = parsed;

                break;
            } catch (error) {
                // May not be an EntryPoint event.
                continue;
            }
        }

        return deepHexlify({
            userOpHash: userOperation.userOpHash,
            sender: userOperation.userOpSender,
            nonce: BigNumber.from(userOperation.userOpNonce.toString()).toHexString(),
            actualGasCost: userOperationEvent?.args[5] ?? 0,
            actualGasUsed: userOperationEvent?.args[6] ?? 0,
            success: userOperationEvent?.args[4] ?? false,
            logs,
            receipt,
            isPending: true,
        });
    } catch (error) {
        console.error(error);
        rpcService.http2Service.sendLarkMessage(`Failed to get user operation receipt: ${Helper.converErrorToString(error)}`);

        return null;
    }
}
