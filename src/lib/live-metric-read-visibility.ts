import {Prisma} from '@prisma/client';
import {z} from 'zod';

const Settings=z.object({rowSecurity:z.enum(['on','off']),statementTimeout:z.string().min(1),
 timeoutMs:z.number().int().nonnegative(),isolation:z.string(),primary:z.boolean(),
 backendPid:z.number().int().positive(),transactionStartedAt:z.string().min(1).max(128)}).strict();
const LiveSettings=Settings.pick({rowSecurity:true,timeoutMs:true,backendPid:true,transactionStartedAt:true});
type Tx=Pick<Prisma.TransactionClient,'$queryRaw'>;
// A private facade can alias another object for the same transaction. Guard
// both object identity and backend/start identity, without retaining clients.
type Coordinator={activeClients:WeakSet<object>;activeTransactions:Set<string>};
const registryKey=Symbol.for('celebratedeal.metricReadVisibility.v1');
const registry=globalThis as typeof globalThis&{[registryKey]?:Coordinator};
// Server bundles can contain separate module copies in one process. Share
// only coordination sets; they retain no source rows or request credentials.
const {activeClients,activeTransactions}=registry[registryKey]??=(
 {activeClients:new WeakSet<object>(),activeTransactions:new Set<string>()});
const AbortedTransaction=z.object({meta:z.object({code:z.literal('25P02')})});

/** Private transaction helper for unfiltered metric evidence reads. The caller
 * owns one primary RR transaction and the authorized scope/lease. RLS off does
 * NOT grant access: a role subject to RLS fails instead of seeing false zero.
 * Never wrap an HTTP request or an unbound/pool client with this helper.
 */
export async function withMetricReadVisibility<T>(tx:Tx,read:()=>Promise<T>):Promise<T>{
 if(activeClients.has(tx))throw new Error('Metric read visibility is already active for this transaction');
 activeClients.add(tx);let key:string|undefined;
 try{
 const settings=await readSettings(tx);
 if(settings.isolation!=='repeatable read'||!settings.primary)throw new Error('Metric read requires primary repeatable-read transaction');
 const candidate=`${settings.backendPid}:${settings.transactionStartedAt}`;
 if(activeTransactions.has(candidate))throw new Error('Metric read visibility is already active for this transaction');
 key=candidate;activeTransactions.add(key);
 // A facade can delay resolving its first metadata query until another guard
 // has finished. Capture the authoritative originals only under exclusivity.
 const authoritative=await readSettings(tx);
 if(authoritative.backendPid!==settings.backendPid||authoritative.transactionStartedAt!==settings.transactionStartedAt
  ||authoritative.isolation!==settings.isolation||authoritative.primary!==settings.primary){
  throw new Error('Metric read visibility requires one explicit transaction');
 }
 return await readWithSettings(tx,authoritative,read);
 }finally{activeClients.delete(tx);if(key)activeTransactions.delete(key);}
}

async function readSettings(tx:Tx){
 const [row]=await tx.$queryRaw<z.infer<typeof Settings>[]>(Prisma.sql`
  SELECT current_setting('row_security') AS "rowSecurity",current_setting('statement_timeout') AS "statementTimeout",
   (SELECT setting::integer FROM pg_settings WHERE name='statement_timeout') AS "timeoutMs",
   current_setting('transaction_isolation') AS isolation,NOT pg_is_in_recovery() AS primary,
   pg_backend_pid() AS "backendPid",extract(epoch FROM transaction_timestamp())::text AS "transactionStartedAt"`);
 return Settings.parse(row);
}

async function readWithSettings<T>(tx:Tx,settings:z.infer<typeof Settings>,read:()=>Promise<T>):Promise<T>{
 const timeoutMs=settings.timeoutMs===0?5000:Math.min(settings.timeoutMs,5000);
 let failed=false;let originalError:unknown;
 try{
  await tx.$queryRaw(Prisma.sql`SELECT set_config('row_security','off',true),set_config('statement_timeout',${`${timeoutMs}ms`},true)`);
  const [live]=await tx.$queryRaw<z.infer<typeof LiveSettings>[]>(Prisma.sql`
   SELECT current_setting('row_security') AS "rowSecurity",
    (SELECT setting::integer FROM pg_settings WHERE name='statement_timeout') AS "timeoutMs",
    pg_backend_pid() AS "backendPid",extract(epoch FROM transaction_timestamp())::text AS "transactionStartedAt"`);
  const checked=LiveSettings.safeParse(live);
  if(!checked.success||checked.data.rowSecurity!=='off'||checked.data.timeoutMs!==timeoutMs
   ||checked.data.backendPid!==settings.backendPid||checked.data.transactionStartedAt!==settings.transactionStartedAt){
   throw new Error('Metric read visibility requires one explicit transaction');
  }
  return await read();
 }
 catch(error){failed=true;originalError=error;throw error;}
 finally{
  try{await tx.$queryRaw(Prisma.sql`SELECT set_config('row_security',${settings.rowSecurity},true),set_config('statement_timeout',${settings.statementTimeout},true)`);}
  catch(error){
   // PostgreSQL aborts a transaction after a SQL error. Restoration may then
   // fail as well; keep the original error and let the caller roll back.
   if(!failed)throw error;
   if(!AbortedTransaction.safeParse(error).success){
    throw new AggregateError([originalError,error],'Metric read visibility restoration failed; transaction must roll back',{cause:originalError});
   }
  }
 }
}
