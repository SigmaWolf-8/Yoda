import { SharedExecutionPanel } from '../components/kyokushin/SharedExecutionPanel';
import { usePageHeader } from '../context/PageHeader';
export function KyokushinPage() {
  usePageHeader({title:'Kyokushin', subtitle:'Agent orchestration · Settings engines · inspectable execution'});
  return <div className="p-6"><SharedExecutionPanel title="Kyokushin · shared agent execution"/></div>;
}
