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
  SettingsControlGroup,
  SettingsFormGrid,
} from '@/features/system-settings/components/settings-form-layout'

import type { ModerationConfigView } from '../../api'
import type { ModerationFormValues } from '../../lib/config-form'
import { ChatKeySection } from './chat-key-section'
import { NumberField, SwitchField } from './fields'

/** Settings of the reviewer that re-checks each judge hit. */
export function ReviewSection(props: { config: ModerationConfigView }) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()

  return (
    <section className='flex flex-col gap-4 rounded-lg border p-4'>
      <h4 className='text-sm font-medium'>{t('Second-pass review')}</h4>
      <SettingsControlGroup>
        <SwitchField
          control={form.control}
          name='review_enabled'
          label={t('Review judge hits')}
          description={t(
            'Each judge hit is checked again by a policy model such as gpt-oss-safeguard under the same rules and threshold. A hit counts only when the reviewer agrees; it stands if the reviewer cannot be reached.'
          )}
        />
      </SettingsControlGroup>
      <SettingsFormGrid>
        <FormField
          control={form.control}
          name='review_base_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base URL</FormLabel>
              <FormControl>
                <Input placeholder='https://openrouter.ai/api' {...field} />
              </FormControl>
              <FormDescription>
                {t(
                  'OpenAI-compatible endpoint, for example https://openrouter.ai/api or https://api.groq.com/openai.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='review_model'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Review model')}</FormLabel>
              <FormControl>
                <Input placeholder='openai/gpt-oss-safeguard-20b' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <NumberField
          control={form.control}
          name='review_timeout_ms'
          label={t('Timeout (ms)')}
          description={t(
            'The reviewer reasons before answering, so allow more time than the judge.'
          )}
        />
      </SettingsFormGrid>
      <ChatKeySection
        title={t('Review API keys')}
        emptyText={t('No review API key configured')}
        missingKeyText={t('The reviewer is enabled but has no API key.')}
        enabled={form.watch('review_enabled')}
        savedKeys={props.config.review_api_key_statuses ?? []}
        newKeysName='review_new_api_keys'
        clearName='clear_review_api_keys'
      />
    </section>
  )
}
