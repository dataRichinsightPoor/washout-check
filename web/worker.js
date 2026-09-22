import {runAudit} from './model.js';
self.onmessage = ({data}) => {
  try { self.postMessage({result: data.parameters ? runAudit(data.parameters,{loading:data.loading}) : runAudit(data)}); }
  catch (error) { self.postMessage({error: error.message}); }
};
