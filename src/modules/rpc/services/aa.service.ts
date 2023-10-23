import { Injectable } from '@nestjs/common';
import { Wallet } from 'ethers';
import { UserOperationService } from './user-operation.service';
import { TransactionService } from './transaction.service';
import { BLOCK_SIGNER_REASON, BUNDLING_MODE, IS_DEVELOPMENT } from '../../../common/common-types';
import { Alert } from '../../../common/alert';
import { ConfigService } from '@nestjs/config';

export enum TRANSACTION_EXTRA_STATUS {
    NONE,
    NONCE_TOO_LOW,
}

@Injectable()
export class AAService {
    private readonly blockedSigners: Map<string, any & { reason: BLOCK_SIGNER_REASON }> = new Map();
    private readonly transactionInSending: Set<string> = new Set();
    private readonly transactionInFinishing: Set<string> = new Set();
    private readonly lockedUserOpHash: Set<string> = new Set();

    private bundlingMode: BUNDLING_MODE = IS_DEVELOPMENT && process.env.MANUAL_MODE ? BUNDLING_MODE.MANUAL : BUNDLING_MODE.AUTO;

    public constructor(
        public readonly userOperationService: UserOperationService,
        public readonly transactionService: TransactionService,
        public readonly configService: ConfigService,
    ) {}

    public getRandomSigners(chainId: number): Wallet[] {
        const signers = this.getSigners();

        return signers.sort(() => Math.random() - 0.5).filter((signer: Wallet) => !this.blockedSigners.has(`${chainId}-${signer.address}`));
    }

    public getSigners(): Wallet[] {
        let pks = this.configService.get('BUNDLER_SIGNERS').split(',');
        return (pks = pks.filter((pk: string) => !!pk).map((privateKey: string) => new Wallet(privateKey)));
    }

    public setBlockedSigner(chainId: number, signerAddress: string, reason: BLOCK_SIGNER_REASON, options: any = {}) {
        options.reason = reason;
        this.blockedSigners.set(`${chainId}-${signerAddress}`, options);

        Alert.sendMessage(`${signerAddress} is blocked on chain ${chainId}`, `Block Signer On Chain ${chainId}`);
    }

    public UnblockedSigner(chainId: number, signerAddress: string) {
        const key = `${chainId}-${signerAddress}`;
        if (this.blockedSigners.has(key)) {
            this.blockedSigners.delete(key);
            Alert.sendMessage(`${signerAddress} is unblocked on chain ${chainId}`, `Unblock Signer On Chain ${chainId}`);
        }
    }

    public getAllBlockedSigners() {
        const blockedSigners: { chainId: number; signerAddress: string; info: any }[] = [];
        for (const [key, info] of this.blockedSigners) {
            const [chainId, signerAddress] = key.split('-');
            blockedSigners.push({
                chainId: Number(chainId),
                signerAddress,
                info,
            });
        }

        return blockedSigners;
    }

    public isBlockedSigner(chainId: number, signerAddress: string) {
        return this.blockedSigners.has(`${chainId}-${signerAddress}`);
    }

    public clearSendingTx(signedTx: string) {
        this.transactionInSending.delete(signedTx);
    }

    public isTxSending(signedTx: string): boolean {
        return this.transactionInSending.has(signedTx);
    }

    public setSendingTx(signedTx: string) {
        this.transactionInSending.add(signedTx);
    }

    public clearFinishingTx(signedTx: string) {
        this.transactionInFinishing.delete(signedTx);
    }

    public isTxFinishing(signedTx: string): boolean {
        return this.transactionInFinishing.has(signedTx);
    }

    public setFinishingTx(signedTx: string) {
        this.transactionInFinishing.add(signedTx);
    }

    public getLockedUserOpHashes(): string[] {
        return Array.from(this.lockedUserOpHash);
    }

    public unlockUserOpHashes(userOpHashes: string[]) {
        for (const userOpHash of userOpHashes) {
            this.lockedUserOpHash.delete(userOpHash);
        }
    }

    public lockUserOpHashes(userOpHashes: string[]) {
        for (const userOpHash of userOpHashes) {
            this.lockedUserOpHash.add(userOpHash);
        }
    }

    // only for development
    public setBundlingMode(bundlingMode: BUNDLING_MODE) {
        if (!IS_DEVELOPMENT) {
            console.error('SetBundlingMode Failed, It is only for development');
            return;
        }

        this.bundlingMode = bundlingMode;
    }

    public getBundlingMode(): BUNDLING_MODE {
        return this.bundlingMode;
    }
}
