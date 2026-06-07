declare module 'net-snmp' {
    export const Version1: number;
    export const Version2c: number;
    export const Version3: number;
    export const SecurityLevel: {
        noAuthNoPriv: number;
        authNoPriv: number;
        authPriv: number;
    };
    export const AuthProtocols: Record<string, number>;
    export const PrivProtocols: Record<string, number>;

    export interface Session {
        get(oids: string[], callback: (err: any, varbinds: Varbind[]) => void): void;
        getBulk(oids: string[], nonRepeaters: number, maxRepetitions: number, callback: (err: any, varbinds: Varbind[]) => void): void;
        close(): void;
    }

    export interface Varbind {
        oid: string;
        type: number;
        value: any;
        sendReceiveTime: number;
    }

    export interface V3User {
        name: string;
        level: number;
        authProtocol: number;
        authKey: string;
        privProtocol: number;
        privKey: string;
    }

    export function createSession(target: string, community: string, options?: any): Session;
    export function createV3Session(target: string, user: V3User, options?: any): Session;
    export function isVarbindError(varbind: Varbind): boolean;
}
