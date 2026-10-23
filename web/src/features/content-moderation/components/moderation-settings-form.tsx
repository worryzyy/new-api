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
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useForm, type Control } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { PasswordInput } from '@/components/password-input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Form,
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { updateSystemOption } from '@/features/system-settings/api'
import {
  SettingsControlChildren,
  SettingsControlGroup,
  SettingsForm,
  SettingsFormGrid,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'
import { SettingsSection } from '@/features/system-settings/components/settings-section'
import { handleServerError } from '@/lib/handle-server-error'
import { requireServerSuccess } from '@/lib/server-error-message'

import {
  MODERATION_CATEGORIES,
  moderationOptionUpdates,
  moderationSettingsSchema,
  type ModerationSettingsValues,
} from '../lib/settings-form'

type NumberFieldName =
  | 'timeout_ms'
  | 'auto_ban_threshold'
  | 'auto_ban_window_hours'
  | 'log_retention_days'

function NumberField(props: {
  control: Control<ModerationSettingsValues>
  name: NumberFieldName
  label: string
  description: string
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{props.label}</FormLabel>
          <FormControl>
            <Input
              type='number'
              value={Number.isFinite(field.value) ? field.value : ''}
              onChange={(event) => field.onChange(event.target.valueAsNumber)}
              onBlur={field.onBlur}
            />
          </FormControl>
          <FormDescription>{props.description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function ModerationSettingsForm(props: {
  savedValues: ModerationSettingsValues
  apiKeyConfigured: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const form = useForm<ModerationSettingsValues>({
    resolver: zodResolver(moderationSettingsSchema),
    defaultValues: props.savedValues,
  })

  useEffect(() => {
    form.reset(props.savedValues)
  }, [props.savedValues, form])

  const onSubmit = async (values: ModerationSettingsValues) => {
    const updates = moderationOptionUpdates(values, props.savedValues)
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    try {
      for (const update of updates) {
        requireServerSuccess(await updateSystemOption(update))
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['system-options'] }),
        queryClient.invalidateQueries({
          queryKey: ['content-moderation', 'status'],
        }),
      ])
      toast.success(t('Setting updated successfully'))
    } catch (error) {
      handleServerError(error, t('Failed to update setting'))
    }
  }

  const mode = form.watch('mode')
  const openaiEnabled = form.watch('openai_enabled')
  const autoBanEnabled = form.watch('auto_ban_enabled')

  return (
    <Form {...form}>
      <SettingsForm onSubmit={form.handleSubmit(onSubmit)}>
        <SettingsSection title={t('Moderation mode')}>
          <Alert>
            <AlertDescription>
              {mode === 'off' &&
                t('Content moderation is off. Requests are not checked.')}
              {mode === 'observe' &&
                t(
                  'Observe mode checks requests in the background and only records violations. Requests are never blocked and users are not banned.'
                )}
              {mode === 'block' &&
                t(
                  'Block mode checks each request before it is sent upstream and rejects violations. Moderation errors never block a request.'
                )}
            </AlertDescription>
          </Alert>
          <FormField
            control={form.control}
            name='mode'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Mode')}</FormLabel>
                <Select
                  items={[
                    { value: 'off', label: t('Off') },
                    { value: 'observe', label: t('Observe only') },
                    { value: 'block', label: t('Block violations') },
                  ]}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className='w-full sm:w-64'>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='off'>{t('Off')}</SelectItem>
                      <SelectItem value='observe'>
                        {t('Observe only')}
                      </SelectItem>
                      <SelectItem value='block'>
                        {t('Block violations')}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='keywords'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Blocked keywords')}</FormLabel>
                <FormControl>
                  <Textarea
                    rows={6}
                    placeholder={t('Enter one keyword per line')}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  {t(
                    'Matched case-insensitively against the latest user message. A keyword match skips the OpenAI check.'
                  )}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsSection>

        <SettingsSection title={t('OpenAI moderation')}>
          <SettingsControlGroup>
            <FormField
              control={form.control}
              name='openai_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>{t('Use OpenAI moderation API')}</FormLabel>
                    <FormDescription>
                      {t(
                        'Sends the latest user message to the OpenAI moderation endpoint, which is free for OpenAI API keys.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
            {openaiEnabled && (
              <SettingsControlChildren>
                <FormField
                  control={form.control}
                  name='check_images'
                  render={({ field }) => (
                    <SettingsSwitchItem>
                      <SettingsSwitchContent>
                        <FormLabel>{t('Check images')}</FormLabel>
                        <FormDescription>
                          {t(
                            'Also sends the first image of the latest user message.'
                          )}
                        </FormDescription>
                      </SettingsSwitchContent>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                        />
                      </FormControl>
                    </SettingsSwitchItem>
                  )}
                />
              </SettingsControlChildren>
            )}
          </SettingsControlGroup>
          {openaiEnabled && (
            <>
              <SettingsFormGrid>
                <FormField
                  control={form.control}
                  name='openai_base_url'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('API base URL')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder='https://api.openai.com'
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='openai_api_key'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('API key')}</FormLabel>
                      <FormControl>
                        <PasswordInput
                          autoComplete='off'
                          placeholder={
                            props.apiKeyConfigured
                              ? t('Configured. Leave blank to keep it.')
                              : 'sk-...'
                          }
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name='openai_model'
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
                  description={t(
                    'Requests are allowed when the check times out.'
                  )}
                />
              </SettingsFormGrid>
              <div className='flex flex-col gap-2'>
                <h4 className='text-sm font-medium'>
                  {t('Category thresholds')}
                </h4>
                <p className='text-muted-foreground text-sm'>
                  {t(
                    'Leave blank to follow the OpenAI decision. A value between 0 and 1 flags the category when its score reaches the value.'
                  )}
                </p>
                <div className='grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
                  {MODERATION_CATEGORIES.map((category) => (
                    <FormField
                      key={category}
                      control={form.control}
                      name={`category_thresholds.${category}`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className='font-mono text-xs'>
                            {category}
                          </FormLabel>
                          <FormControl>
                            <Input
                              inputMode='decimal'
                              placeholder={t('Default')}
                              {...field}
                              value={field.value ?? ''}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </SettingsSection>

        <SettingsSection title={t('Automatic ban')}>
          <SettingsControlGroup>
            <FormField
              control={form.control}
              name='auto_ban_enabled'
              render={({ field }) => (
                <SettingsSwitchItem>
                  <SettingsSwitchContent>
                    <FormLabel>
                      {t('Disable users with repeated violations')}
                    </FormLabel>
                    <FormDescription>
                      {t(
                        'Applies to blocked requests only. Administrators are never disabled. Unbanning a user resets the count.'
                      )}
                    </FormDescription>
                  </SettingsSwitchContent>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </SettingsSwitchItem>
              )}
            />
          </SettingsControlGroup>
          {autoBanEnabled && (
            <SettingsFormGrid>
              <NumberField
                control={form.control}
                name='auto_ban_threshold'
                label={t('Violation threshold')}
                description={t(
                  'Number of blocked requests that disables the user.'
                )}
              />
              <NumberField
                control={form.control}
                name='auto_ban_window_hours'
                label={t('Counting window (hours)')}
                description={t(
                  'Only violations within this window are counted.'
                )}
              />
            </SettingsFormGrid>
          )}
        </SettingsSection>

        <SettingsSection title={t('Scope')}>
          <SettingsFormGrid>
            {(
              [
                [
                  'include_groups',
                  t('Groups to check'),
                  t(
                    'Comma or newline separated. Leave blank to check all groups.'
                  ),
                ],
                [
                  'include_models',
                  t('Models to check'),
                  t(
                    'Leave blank to check all models. A trailing * matches a prefix.'
                  ),
                ],
                [
                  'exclude_models',
                  t('Models to skip'),
                  t('A trailing * matches a prefix.'),
                ],
                [
                  'exempt_user_ids',
                  t('Exempt user IDs'),
                  t('Requests from these users are never checked.'),
                ],
              ] as const
            ).map(([name, label, description]) => (
              <FormField
                key={name}
                control={form.control}
                name={name}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                    <FormDescription>{description}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <NumberField
              control={form.control}
              name='log_retention_days'
              label={t('Record retention (days)')}
              description={t(
                'Older records are deleted automatically. 0 keeps records forever.'
              )}
            />
          </SettingsFormGrid>
        </SettingsSection>

        <div className='flex justify-end'>
          <Button type='submit' disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? t('Saving...') : t('Save Changes')}
          </Button>
        </div>
      </SettingsForm>
    </Form>
  )
}
