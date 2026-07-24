import { useEffect, useState } from 'react';
import { Tabs } from '../components/UI';
import { useLang } from '../components/LangContext';
import MailboxBackupPanel from './tools/MailboxBackupPanel';
import InventoryPanel from './tools/InventoryPanel';
import HandoverPanel from './tools/HandoverPanel';

const TABS = ['backup', 'inventory', 'handover'];

export default function ToolsPage({ user, subPath }) {
  const { t: tr } = useLang();
  const [tab, setTab] = useState(() => (TABS.includes(subPath) ? subPath : 'backup'));

  useEffect(() => {
    if (TABS.includes(subPath) && subPath !== tab) setTab(subPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subPath]);

  const changeTab = (id) => {
    setTab(id);
    window.history.replaceState(null, '', `/#tools/${id}`);
  };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Tabs
        tabs={[
          { id: 'backup', label: tr('toolTabBackup') },
          { id: 'inventory', label: tr('toolTabInventory') },
          { id: 'handover', label: tr('toolTabHandover') },
        ]}
        active={tab}
        onChange={changeTab}
      />
      {tab === 'backup' && <MailboxBackupPanel />}
      {tab === 'inventory' && <InventoryPanel user={user} />}
      {tab === 'handover' && <HandoverPanel />}
    </div>
  );
}
