import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { EngineStatusStrip } from '../monitoring/EngineStatusStrip';

interface Run {
  task: { id:string; project_id:string; title:string; status:string; primary_agent_role:string; error_message?:string };
  results: { id:string; step_number:number; result_content:string; engine_slot:string; engine_model:string; agent_role:string }[];
  reviews: { id:string; engine_slot:string; engine_model:string; agent_role:string; verdict:unknown }[];
  events: { id:string; engine_slot:string; configured_model:string; route:string; peer?:string; state:string; output?:string; error?:string; started_at:string; finished_at?:string }[];
  worker?: { enabled:boolean; message:string };
}
export function SharedExecutionPanel({ title='Shared agent execution' }: {title?:string}) {
  const [project,setProject]=useState('');
  const [text,setText]=useState('');
  const [runId,setRunId]=useState(() => localStorage.getItem('yoda.lastSharedRun') ?? '');
  const projects=useQuery({queryKey:['execution-projects'],queryFn:async()=>{
    const r=await api.get<{projects:{id:string;name:string}[]}>('/projects'); return r.data.projects;
  }});
  const run=useQuery({queryKey:['execution-run',runId],enabled:!!runId,
    queryFn:async()=> (await api.get<Run>(`/execution/runs/${runId}`)).data,refetchInterval:3000});
  const submit=useMutation({mutationFn:async()=>{
    const r=await api.post<{task_id:string}>('/execution/runs',{project_id:project,text});
    return r.data;
  },onSuccess:data=>{setRunId(data.task_id);localStorage.setItem('yoda.lastSharedRun',data.task_id);}});
  const data=run.data;
  return <section className="space-y-4 p-5 rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface-secondary)] text-[var(--color-text-primary)]">
    <h2 className="text-xl font-semibold">{title}</h2>
    <p className="text-sm">Forge, Kyokushin and project queries share the same agent worker, Settings engines and durable run records. Project review requirements are never silently reduced.</p>
    <EngineStatusStrip/>
    <form className="space-y-3" onSubmit={e=>{e.preventDefault();submit.mutate();}}>
      <label className="block text-sm">Project and review policy
        <select required value={project} onChange={e=>setProject(e.target.value)} className="block w-full mt-1 p-2 bg-[var(--color-surface-tertiary)] rounded">
          <option value="">Choose a project</option>
          {projects.data?.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {projects.isError && <p role="alert">Could not load projects. Nothing has been submitted.</p>}
      {!projects.isLoading && !projects.data?.length && <Link to="/projects" className="underline">Create a project first</Link>}
      <label className="block text-sm">Work for the agents
        <textarea required maxLength={100000} value={text} onChange={e=>setText(e.target.value)}
          className="block w-full mt-1 p-3 min-h-32 bg-[var(--color-surface-tertiary)] rounded"/>
      </label>
      <button disabled={submit.isPending||!project||!text.trim()} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-40">
        {submit.isPending?'Saving run…':'Submit to shared agent queue'}
      </button>
      {submit.isError && <p role="alert">Submission failed: {(submit.error as {response?:{data?:{error?:string}}}).response?.data?.error ?? submit.error.message}</p>}
    </form>
    {runId && <div className="border-t border-[var(--color-border-subtle)] pt-4 space-y-3">
      <h3 className="font-semibold">Execution evidence</h3>
      <p className="text-xs break-all">Run {runId}{data && <> · <Link className="underline" to={`/projects/${data.task.project_id}/tasks`}>Open project tasks</Link></>}</p>
      {run.isError && <p role="alert">Run unavailable or no longer accessible. No successful result is assumed.</p>}
      {data && <>
        <p>Status: <strong>{data.task.status}</strong> · Selected agent: {data.task.primary_agent_role || 'Not selected'}</p>
        <p className="text-sm whitespace-pre-wrap">{data.task.title}</p>
        {data.worker && <p className="text-sm">{data.worker.enabled?'Worker enabled':'Worker paused'} · {data.worker.message}</p>}
        {data.task.error_message && <p role="status">{data.task.error_message}</p>}
        {!data.events.length && !data.results.length && <p>No model output recorded. Queued or blocked work is not a completed run.</p>}
        {data.events.map(e=><details key={e.id} className="border rounded p-3" open={e.state==='failed'}>
          <summary>{e.engine_slot.toUpperCase()} · {e.configured_model} · {e.state}</summary>
          <p className="text-xs">{e.route}{e.peer?` · daemon ${e.peer}`:''} · {new Date(e.started_at).toLocaleString()}</p>
          <p className="text-xs">Request {e.id}</p>
          {e.output && <pre className="whitespace-pre-wrap overflow-auto max-h-96 text-sm">{e.output}</pre>}
          {e.error && <p>{e.error}</p>}
        </details>)}
        {data.results.map(r=><details key={r.id} className="border rounded p-3">
          <summary>Step {r.step_number} · {r.agent_role} · {r.engine_slot.toUpperCase()} / {r.engine_model}</summary>
          <pre className="whitespace-pre-wrap overflow-auto max-h-96 text-sm">{r.result_content}</pre>
        </details>)}
        {data.reviews.map(r=><details key={r.id} className="border rounded p-3"><summary>Review · {r.agent_role} · {r.engine_model}</summary>
          <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(r.verdict,null,2)}</pre></details>)}
        <p className="text-xs">Model output and reviewer agreement are not mathematical proofs. Use executable formula evidence for specific mathematical checks.</p>
      </>}
    </div>}
  </section>;
}
