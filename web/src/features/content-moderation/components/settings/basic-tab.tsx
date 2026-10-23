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
import {
  FormControl,
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
import {
  SettingsControlGroup,
  SettingsFormGrid,
} from '@/features/system-settings/components/settings-form-layout'

import type { ModerationConfigView } from '../../api'
import type { ModerationFormValues } from '../../lib/config-form'
import { NumberField, SwitchField } from './fields'
import { KeyPoolSection } from './key-pool-section'

export function BasicTab(props: { config: ModerationConfigView }) {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const mode = form.watch('mode')
  const modeItems = [
    { value: 'pre_block', label: t('Pre-block') },
    { value: 'observe', label: t('Observe only') },
    { value: 'off', label: t('Off') },
  ]
  let modeHint = t('Moderation is off; requests are not checked or recorded.')
  if (mode === 'pre_block') {
    modeHint = t(
      'Each request is checked before it is sent upstream and rejected on a hit. Moderation errors never block a request.'
    )
  } else if (mode === 'observe') {
    modeHint = t(
      'Requests pass immediately and are checked in the background queue. Hits are recorded and still count toward automatic bans.'
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      <SettingsControlGroup>
        <SwitchField
          control={form.control}
          name='enabled'
          label={t('Enable content audit')}
          description={t(
            'Checks the latest user message of relay requests with the settings below.'
          )}
        />
      </SettingsControlGroup>
      <SettingsFormGrid>
        <FormField
          control={form.control}
          name='mode'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Mode')}</FormLabel>
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
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='base_url'
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base URL</FormLabel>
              <FormControl>
                <Input placeholder='https://api.openai.com' {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name='model'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Moderation model')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <NumberField
          control={form.control}
          name='timeout_ms'
          label={t('Timeout (ms)')}
          description={t('Requests are allowed when the check times out.')}
        />
        <NumberField
          control={form.control}
          name='retry_count'
          label={t('Retry count')}
          description={t('Each retry uses the next available key.')}
        />
        <NumberField
          control={form.control}
          name='sample_rate'
          label={t('Sample rate (%)')}
          description={t(
            'The same content is always either sampled or skipped.'
          )}
        />
      </SettingsFormGrid>
      <Alert>
        <AlertDescription>{modeHint}</AlertDescription>
      </Alert>
      <SettingsControlGroup>
        <SwitchField
          control={form.control}
          name='check_images'
          label={t('Check images')}
          description={t(
            'Also sends the first image of the latest user message.'
          )}
        />
      </SettingsControlGroup>
      <KeyPoolSection config={props.config} />
    </div>
  )
}
