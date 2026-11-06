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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  SettingsControlGroup,
  SettingsFormGrid,
} from '@/features/system-settings/components/settings-form-layout'

import type { ModerationConfigView, ModerationStatus } from '../../api'
import {
  MAX_JUDGE_RULE_CHARS,
  type ModerationFormValues,
} from '../../lib/config-form'
import { ChatKeySection } from './chat-key-section'
import { NumberField, SwitchField } from './fields'
import { JudgeTestPanel } from './judge-test-panel'
import { ReviewSection } from './review-section'

export function JudgeTab(props: {
  config: ModerationConfigView
  status?: ModerationStatus
}) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const enabled = form.watch('judge_enabled')
  const rulesLength = form.watch('judge_rules').length
  const modeItems = [
    { value: 'observe', label: t('Observe only') },
    { value: 'pre_block', label: t('Pre-block') },
  ]

  return (
    <div className='flex flex-col gap-5'>
      <Alert>
        <AlertDescription>
          {t(
            'The LLM judge asks a chat model whether the latest user message breaks the rules below, catching intent the OpenAI categories miss. It runs alongside OpenAI moderation and follows the same scope, sampling and exemptions.'
          )}
        </AlertDescription>
      </Alert>
      <SettingsControlGroup>
        <SwitchField
          control={form.control}
          name='judge_enabled'
          label={t('Enable LLM judge')}
          description={t(
            'Messages shorter than 10 characters are skipped, and passed content is not judged again for 24 hours (needs Redis).'
          )}
        />
        <SwitchField
          control={form.control}
          name='judge_count_toward_ban'
          label={t('Count judge hits toward bans')}
          description={t(
            'While off, judge hits are only recorded, so wrong verdicts never disable a user. Turn it on once the verdicts look right.'
          )}
        />
      </SettingsControlGroup>
      <SettingsFormGrid>
        <FormField
          control={form.control}
          name='judge_mode'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Judge mode')}</FormLabel>
              <Select
                items={modeItems}
                value={field.value}
                onValueChange={field.onChange}
              >
                <FormControl>
                  <SelectTrigger className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {modeItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FormDescription>
                {t(
                  'Observe only judges in the background and never blocks. Pre-block holds each request for the verdict (adds 1-3 s) and needs the audit mode set to pre-block.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='judge_base_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base URL</FormLabel>
              <FormControl>
                <Input placeholder='https://api.deepseek.com' {...field} />
              </FormControl>
              <FormDescription>
                {t(
                  'Any OpenAI-compatible chat completions endpoint. Avoid OpenAI itself so reviewed content is not sent to the protected upstream again.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='judge_model'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Judge model')}</FormLabel>
              <FormControl>
                <Input placeholder='deepseek-flash' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <NumberField
          control={form.control}
          name='judge_threshold'
          label={t('Confidence threshold (%)')}
          description={t(
            'A violation counts only when the judge is at least this sure (1-100).'
          )}
        />
        <NumberField
          control={form.control}
          name='judge_timeout_ms'
          label={t('Timeout (ms)')}
          description={t('Requests are allowed when the check times out.')}
        />
      </SettingsFormGrid>

      <ChatKeySection
        title={t('Judge API keys')}
        emptyText={t('No judge API key configured')}
        missingKeyText={t('The judge is enabled but has no API key.')}
        enabled={enabled}
        savedKeys={props.config.judge_api_key_statuses ?? []}
        newKeysName='judge_new_api_keys'
        clearName='clear_judge_api_keys'
      />
      <ReviewSection config={props.config} />

      <FormField
        control={form.control}
        name='judge_rules'
        render={({ field }) => (
          <FormItem>
            <div className='flex items-center justify-between gap-2'>
              <FormLabel>{t('Judge rules')}</FormLabel>
              <Button
                type='button'
                size='sm'
                variant='outline'
                onClick={() =>
                  form.setValue(
                    'judge_rules',
                    props.config.judge_default_rules,
                    { shouldDirty: true }
                  )
                }
              >
                {t('Reset to defaults')}
              </Button>
            </div>
            <FormControl>
              <Textarea rows={14} className='text-sm' {...field} />
            </FormControl>
            <FormDescription>
              {t(
                'Plain-language policy sent to the judge: what counts as a violation and what does not. When a verdict is wrong, add that case to the "does not count" part. {{count}} / {{max}} characters.',
                { count: rulesLength, max: MAX_JUDGE_RULE_CHARS }
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {props.status && (
        <p className='text-muted-foreground text-xs tabular-nums'>
          {t(
            'Since this process started: {{checked}} judged, {{flagged}} hits, {{errors}} errors, {{cached}} skipped as already passed, average {{latency}} ms',
            {
              checked: props.status.judge_checked ?? 0,
              flagged: props.status.judge_flagged ?? 0,
              errors: props.status.judge_errors ?? 0,
              cached: props.status.judge_cache_hits ?? 0,
              latency: props.status.judge_avg_latency_ms ?? 0,
            }
          )}
          {props.status.review_enabled &&
            ` · ${t('{{reviewed}} reviewed, {{overruled}} overruled, {{errors}} review errors', { reviewed: props.status.review_checked ?? 0, overruled: props.status.review_overruled ?? 0, errors: props.status.review_errors ?? 0 })}`}
        </p>
      )}
      <JudgeTestPanel />
    </div>
  )
}
