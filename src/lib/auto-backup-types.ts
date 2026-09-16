export interface ManagedBackup { id:string; path:string; createdAt:string; bytes:number; sha256:string }
export interface AutoBackupSettings { enabled:boolean; directory:string; trigger:'daily'|'session'; keep:number; lastAttempt:string|null; lastSuccess:string|null; lastError:string|null; lastFingerprint:string|null; archives:ManagedBackup[] }
export interface AutoBackupStatus { settings:AutoBackupSettings; availableBytes:number|null; cleanup:ManagedBackup[]; message:string }
