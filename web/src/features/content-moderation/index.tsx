/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, Settings } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

import {
  getGroupNames,
  getModerationConfig,
  getModerationLogs,
  getModerationStatus,
  type ModerationLogFilters,
} from './api'
import { ModerationLogViewer } from './components/moderation-log-viewer'
import {
  PreBlockPanels,
  WorkerPanel,
} from './components/moderation-runtime-panels'
import { ModerationStatusCards } from './components/moderation-status-cards'
import { ModerationSettingsDialog } from './components/settings/moderation-settings-dialog'

const STATUS_REFRESH_MS = 15_000

export function ContentModeration() {
  const { t } = useTranslation()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [filters, setFilters] = useState<ModerationLogFilters>({
    p: 1,
    page_size: 20,
  })
  const config = useQuery({
    queryKey: ['content-moderation', 'config'],
    queryFn: getModerationConfig,
  })
  const status = useQuery({
    queryKey: ['content-moderation', 'status'],
    queryFn: getModerationStatus,
    refetchInterval: STATUS_REFRESH_MS,
  })
  const logs = useQuery({
    queryKey: ['content-moderation', 'logs', filters],
    queryFn: () => getModerationLogs(filters),
    retry: false,
  })
  const groups = useQuery({
    queryKey: ['content-moderation', 'groups'],
    queryFn: getGroupNames,
  })

  const mode = config.data?.mode
  const active = !!config.data?.enabled && mode !== 'off'
  const allKeysUnavailable =
    !!status.data &&
    status.data.api_key_count > 0 &&
    status.data.api_key_available_count === 0
  const refresh = () => {
    void status.refetch()
    void config.refetch()
    void logs.refetch()
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Content audit')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button
          variant='outline'
          size='sm'
          onClick={refresh}
          disabled={status.isFetching}
        >
          <RefreshCw data-icon='inline-start' aria-hidden='true' />
          {t('Refresh status')}
        </Button>
        <Button
          size='sm'
          disabled={!config.data}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings data-icon='inline-start' aria-hidden='true' />
          {t('Content audit settings')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        {config.isError ? (
          <ErrorState
            title={t('Failed to load settings')}
            onRetry={() => void config.refetch()}
          />
        ) : (
          <div className='flex flex-col gap-4 pb-6'>
            <p className='text-muted-foreground text-sm'>
              {t('Configure content audit policies and review audit records')}
              {' · '}
              {t('Active engine: {{engine}}', { engine: 'OpenAI' })}
            </p>
            {allKeysUnavailable && (
              <Alert variant='destructive'>
                <AlertDescription>
                  {t(
                    'All moderation API keys are frozen or failing; requests are currently allowed without moderation.'
                  )}
                </AlertDescription>
              </Alert>
            )}
            <ModerationStatusCards
              status={status.data}
              config={config.data}
              logTotal={logs.data?.total}
              loading={config.isPending}
            />
            {status.data && active && mode === 'pre_block' && (
              <PreBlockPanels status={status.data} />
            )}
            {status.data && active && mode === 'observe' && (
              <WorkerPanel status={status.data} />
            )}
            <Card size='sm'>
              <CardHeader>
                <CardTitle>{t('Audit records')}</CardTitle>
                <CardDescription>
                  {t(
                    'Hits are always recorded; passed checks are recorded only when non-hit recording is on.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ModerationLogViewer
                  query={logs}
                  filters={filters}
                  setFilters={setFilters}
                  groups={groups.data ?? []}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </SectionPageLayout.Content>
      {config.data && (
        <ModerationSettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          config={config.data}
          status={status.data}
        />
      )}
    </SectionPageLayout>
  )
}
