import {replayEvidence} from './replay.js';
import {createServer} from '../backend/server.js';

try{
  const{state,created}=await replayEvidence();
  console.log(`Recorded AI evidence ${created?'loaded':'already loaded'}: ${state.replay.sourceRunId}. No new provider calls.`);
  const server=await createServer();
  console.log(`Accessible by Morning: http://127.0.0.1:${server.address().port}`);
}catch(error){
  console.error(error.code==='EADDRINUSE'?'The configured port is in use. Stop the existing demo or set PORT to an available port before restarting.':error.message);
  process.exitCode=1;
}
