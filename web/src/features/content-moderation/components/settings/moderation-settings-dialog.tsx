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
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useForm, type FieldErrors } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { handleServerError } from '@/lib/handle-server-error'

import {
  updateModerationConfig,
  type ModerationConfigView,
  type ModerationStatus,
} from '../../api'
import {
  buildConfigUpdate,
  formValuesFromConfig,
  moderationFormSchema,
  type ModerationFormValues,
} from '../../lib/config-form'
import { BasicTab } from './basic-tab'
import { HitTab, KeywordsTab, ThresholdsTab } from './policy-tabs'
import { QueueTab, RetentionTab } from './runtime-tabs'
import { ScopeTab } from './scope-tab'

type TabKey =
  | 'basic'
  | 'scope'
  | 'queue'
  | 'hit'
  | 'thresholds'
  | 'keywords'
  | 'retention'

const FIELD_TABS: Partial<Record<keyof ModerationFormValues, TabKey>> = {
  groups: 'scope',
  model_filter_models: 'scope',
  exempt_user_ids: 'scope',
  worker_count: 'queue',
  queue_size: 'queue',
  block_status: 'hit',
  block_message: 'hit',
  ban_threshold: 'hit',
  violation_window_hours: 'hit',
  thresholds: 'thresholds',
  blocked_keywords: 'keywords',
  hit_retention_days: 'retention',
  non_hit_retention_days: 'retention',
}

export function ModerationSettingsDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: ModerationConfigView
  status?: ModerationStatus
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<TabKey>('basic')
  const form = useForm<ModerationFormValues>({
    resolver: zodResolver(moderationFormSchema),
    defaultValues: formValuesFromConfig(props.config),
  })

  const { open, config } = props
  useEffect(() => {
    if (open) {
      form.reset(formValuesFromConfig(config))
      setTab('basic')
    }
  }, [open, config, form])

  const save = useMutation({
    mutationFn: (values: ModerationFormValues) =>
      updateModerationConfig(buildConfigUpdate(values)),
    onSuccess: async (view) => {
      queryClient.setQueryData(['content-moderation', 'config'], view)
      await queryClient.invalidateQueries({
        queryKey: ['content-moderation', 'status'],
      })
      toast.success(t('Setting updated successfully'))
      props.onOpenChange(false)
    },
    onError: (error) => handleServerError(error, t('Failed to update setting')),
  })

  const onInvalid = (errors: FieldErrors<ModerationFormValues>) => {
    const field = Object.keys(errors)[0] as
      | keyof ModerationFormValues
      | undefined
    setTab((field && FIELD_TABS[field]) ?? 'basic')
    toast.error(t('Please fix the highlighted fields'))
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'basic', label: t('Basic') },
    { key: 'scope', label: t('Audit scope') },
    { key: 'queue', label: t('Run queue') },
    { key: 'hit', label: t('Hit handling') },
    { key: 'thresholds', label: t('Risk thresholds') },
    { key: 'keywords', label: t('Keyword blocking') },
    { key: 'retention', label: t('Log retention') },
  ]

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Content audit settings')}
      description={t('Changes take effect immediately after saving.')}
      contentClassName='min-w-0 sm:max-w-5xl max-sm:w-[calc(100vw-1.5rem)] max-sm:max-w-[calc(100vw-1.5rem)]'
      contentHeight='min(85vh, 860px)'
      bodyClassName='min-h-0'
      footer={
        <>
          <Button variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button
            disabled={save.isPending}
            onClick={form.handleSubmit(
              (values) => save.mutate(values),
              onInvalid
            )}
          >
            {save.isPending ? t('Saving...') : t('Save Changes')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          onSubmit={(event) => event.preventDefault()}
          className='flex min-h-0 flex-col gap-4'
        >
          <Tabs value={tab} onValueChange={(value) => setTab(value as TabKey)}>
            <TabsList className='flex h-auto w-full flex-wrap justify-start'>
              {tabs.map((item) => (
                <TabsTrigger key={item.key} value={item.key}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent value='basic' className='pt-4'>
              <BasicTab config={props.config} />
            </TabsContent>
            <TabsContent value='scope' className='pt-4'>
              <ScopeTab />
            </TabsContent>
            <TabsContent value='queue' className='pt-4'>
              <QueueTab status={props.status} />
            </TabsContent>
            <TabsContent value='hit' className='pt-4'>
              <HitTab />
            </TabsContent>
            <TabsContent value='thresholds' className='pt-4'>
              <ThresholdsTab />
            </TabsContent>
            <TabsContent value='keywords' className='pt-4'>
              <KeywordsTab />
            </TabsContent>
            <TabsContent value='retention' className='pt-4'>
              <RetentionTab status={props.status} />
            </TabsContent>
          </Tabs>
        </form>
      </Form>
    </Dialog>
  )
}
