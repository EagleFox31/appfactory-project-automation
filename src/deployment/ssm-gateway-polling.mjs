// Bounded SSM command monitoring. AWS access is injected by the caller;
// this module cannot dispatch commands or assume IAM roles.
import {classifySsmInvocation,validateSsmInvocationTarget} from './ssm-invocation-guard.mjs';

export async function waitForSsmInvocation({
  target, getInvocation, sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  now=()=>Date.now(), timeoutMs=180000, pollMs=3000
}) {
  const expected=validateSsmInvocationTarget(target);
  if(typeof getInvocation!=='function' || typeof sleep!=='function' || typeof now!=='function')
    throw new Error('SSM polling requires explicit dependencies');
  if(!Number.isSafeInteger(timeoutMs) || timeoutMs<1000 || timeoutMs>900000)
    throw new Error('SSM polling timeout must be 1 to 900 seconds');
  if(!Number.isSafeInteger(pollMs) || pollMs<100 || pollMs>30000)
    throw new Error('SSM polling interval must be 100 to 30000 milliseconds');
  const start=now();
  if(!Number.isFinite(start))throw new Error('SSM clock is invalid');
  const deadline=start+timeoutMs;
  let attempts=0;
  while(true) {
    if(now()>=deadline)throw new Error('SSM invocation polling deadline exceeded');
    let response;
    try {
      response=await getInvocation({...expected});
    }catch(error) {
      // Eventual consistency can cause an initial invocation lookup to be absent.
      // No other AWS error is silently retried.
      if(error?.name!=='InvocationDoesNotExist' && error?.code!=='InvocationDoesNotExist')
        throw error;
      response=null;
    }
    attempts++;
    if(response) {
      const verdict=classifySsmInvocation(response,expected);
      if(verdict.state==='success')return {status:verdict.status,attempts};
      if(verdict.state==='failure')throw new Error('SSM command failed: '+verdict.status);
    }
    const remaining=deadline-now();
    if(remaining<=0)throw new Error('SSM invocation polling deadline exceeded');
    await sleep(Math.min(pollMs,remaining));
  }
}
