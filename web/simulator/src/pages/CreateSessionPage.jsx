import ErrorNotice from "../components/ErrorNotice.jsx";
import { useSession } from "../state/SessionContext.jsx";

export default function CreateSessionPage() {
  const { error } = useSession();
  return <section><p className="eyebrow">配置驱动 · 历史日线</p><h1>创建交易练习</h1><ErrorNotice error={error} /><p>选择历史区间和候选规则，开始匿名练习。</p></section>;
}
