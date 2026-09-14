import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useEndpointQuery } from '../src/hooks/useEndpointQuery';
import { useReactiveLoader } from '../src/hooks/useReactiveLoader';
import { useReactiveEffect } from '../src/hooks/useReactiveEffect';
import { useQuery } from '../src/hooks/useQuery';
import { queryEndpoint, receiveEndpointRevision, setEndpointPermissionScope } from '../src/lib/app-endpoints-sdk';
import DashboardPanel from '../src/components/DashboardPanel';

type Result = { value: number };
function Query({ group, id }: { group: string; id: string }) {
  const renders = ((window as any).renderCounts ||= {});
  renders[id] = (renders[id] || 0) + 1;
  const { data, loading } = useEndpointQuery<Result>('getQueryReport', { group });
  return <p data-testid={id}>{loading ? 'loading' : data?.value}</p>;
}
function Legacy({ group, editing }: { group: string; editing: boolean }) {
  const [value, setValue] = useState<number | undefined>();
  const [loading, setLoading] = useState(true);
  const run = useReactiveLoader(async read => {
    if (!read.background) setLoading(true);
    try { const result = await read(() => queryEndpoint<Result>('getLoaderReport', { group })); setValue(result.value); }
    catch (error) { if (!read.cancelled) throw error; }
    finally { if (!read.cancelled) setLoading(false); }
  }, [group], !editing);
  useEffect(() => { void run(); }, [run]);
  return <p data-testid="legacy">{loading ? 'loading' : value}</p>;
}
function Effect({ group }: { group: string }) {
  const [value, setValue] = useState<number | undefined>();
  useReactiveEffect(read => {
    read(() => queryEndpoint<Result>('getEffectReport', { group }))
      .then(result => { if (!read.cancelled) setValue(result.value); }).catch(() => {});
  }, [group]);
  return <p data-testid="effect">{value ?? 'loading'}</p>;
}
function CompatibilityQuery({ group }: { group: string }) {
  const { data } = useQuery<Result>({ key: `compat-${group}`, fetcher: () => queryEndpoint('getCompatReport', { group }) });
  return <p data-testid="compat">{data?.value ?? 'loading'}</p>;
}
function App() {
  const [group, setGroup] = useState('A');
  const [active, setActive] = useState(true);
  const [editing, setEditing] = useState(false);
  const [compatVisible, setCompatVisible] = useState(true);
  const [legacyVisible, setLegacyVisible] = useState(true);
  return <>
    <input aria-label="Preserved draft" defaultValue="draft" />
    <button onClick={() => setGroup(group === 'A' ? 'B' : 'A')}>Change group</button>
    <button onClick={() => setActive(!active)}>Toggle panel</button>
    <button onClick={() => setEditing(!editing)}>Toggle editing</button>
    <button onClick={() => setCompatVisible(!compatVisible)}>Toggle compatibility view</button>
    <button onClick={() => setLegacyVisible(!legacyVisible)}>Toggle loader view</button>
    <span data-testid="group">{group}</span>
    <DashboardPanel active={active}>
      <Query group={group} id="query" /><Query group={group} id="duplicate" />
      {legacyVisible && <Legacy group={group} editing={editing} />}<Effect group={group} />
      {compatVisible && <CompatibilityQuery group={group} />}
    </DashboardPanel>
    <Query group="unrelated" id="unrelated" />
  </>;
}
(window as any).receiveRevision = receiveEndpointRevision;
(window as any).setPermissionScope = setEndpointPermissionScope;
createRoot(document.getElementById('root')!).render(<App />);
