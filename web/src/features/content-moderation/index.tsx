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
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ErrorState } from '@/components/error-state'
import { SectionPageLayout } from '@/components/layout'
import { LoadingState } from '@/components/loading-state'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSystemOptions } from '@/features/system-settings/hooks/use-system-options'

import { getModerationStatus } from './api'
import { ModerationLogViewer } from './components/moderation-log-viewer'
import { ModerationSettingsForm } from './components/moderation-settings-form'
import { ModerationTestPanel } from './components/moderation-test-panel'
import { moderationValuesFromOptions } from './lib/settings-form'

function ModerationSettingsTab() {
  const { t } = useTranslation()
  const options = useSystemOptions()
  const status = useQuery({
    queryKey: ['content-moderation', 'status'],
    queryFn: getModerationStatus,
  })
  const savedValues = useMemo(
    () => moderationValuesFromOptions(options.data?.data ?? []),
    [options.data]
  )

  if (options.isPending) return <LoadingState />
  if (options.isError) {
    return (
      <ErrorState
        title={t('Failed to load settings')}
        onRetry={() => void options.refetch()}
      />
    )
  }
  return (
    <div className='flex h-full min-h-0 flex-col gap-8 overflow-y-auto pb-6'>
      <ModerationSettingsForm
        savedValues={savedValues}
        apiKeyConfigured={status.data?.openai_api_key_configured ?? false}
      />
      <ModerationTestPanel />
    </div>
  )
}

export function ContentModeration() {
  const { t } = useTranslation()
  const [tab, setTab] = useState<'logs' | 'settings'>('logs')

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        {t('Content Moderation')}
      </SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setTab(value === 'settings' ? 'settings' : 'logs')
          }
        >
          <TabsList aria-label={t('Content Moderation')}>
            <TabsTrigger value='logs'>{t('Violation records')}</TabsTrigger>
            <TabsTrigger value='settings'>{t('Settings')}</TabsTrigger>
          </TabsList>
        </Tabs>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col'>
          {tab === 'logs' ? <ModerationLogViewer /> : <ModerationSettingsTab />}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
