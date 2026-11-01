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
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'

import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { DateTimePicker } from '@/components/datetime-picker'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { sortTopUpBonusTiers, tierReward } from '@/features/activities/lib/bonus'
import type { TopUpBonusTier } from '@/features/activities/types'
import { formatCurrencyFromUSD } from '@/lib/currency'

import {
  SettingsForm,
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '../components/settings-form-layout'
import { SettingsPageFormActions } from '../components/settings-page-context'
import { SettingsSection } from '../components/settings-section'
import { useUpdateOption } from '../hooks/use-update-option'
import { TopUpBonusTierDialog } from './topup-bonus-tier-dialog'

const KEY = 'topup_bonus_setting'

type Values = {
  enabled: boolean
  title: string
  description: string
  start: Date | null
  end: Date | null
  tiers: TopUpBonusTier[]
}

function createSchema(t: (key: string) => string) {
  return z
    .object({
      enabled: z.boolean(),
      title: z.string().max(100),
      description: z.string().max(2000),
      start: z.date().nullable(),
      end: z.date().nullable(),
      tiers: z.array(z.custom<TopUpBonusTier>()),
    })
    .refine((v) => !v.start || !v.end || v.end > v.start, {
      message: t('The end time must be after the start time'),
      path: ['end'],
    })
    .refine((v) => !v.enabled || v.tiers.length > 0, {
      message: t('Add at least one bonus tier before enabling the campaign'),
      path: ['tiers'],
    })
}

function parseTopUpBonusTiers(raw: string): TopUpBonusTier[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? sortTopUpBonusTiers(parsed) : []
  } catch {
    return []
  }
}

const toDate = (seconds: number) => (seconds > 0 ? new Date(seconds * 1000) : null)
const toSeconds = (date: Date | null) =>
  date ? Math.floor(date.getTime() / 1000) : 0

export function TopUpBonusSettingsSection(props: {
  defaultValues: {
    enabled: boolean
    title: string
    description: string
    startTime: number
    endTime: number
    tiers: string
  }
}) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TopUpBonusTier | null>(null)

  const initial = useMemo<Values>(
    () => ({
      enabled: props.defaultValues.enabled,
      title: props.defaultValues.title,
      description: props.defaultValues.description,
      start: toDate(props.defaultValues.startTime),
      end: toDate(props.defaultValues.endTime),
      tiers: parseTopUpBonusTiers(props.defaultValues.tiers),
    }),
    [props.defaultValues]
  )

  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)) as unknown as Resolver<Values>,
    defaultValues: initial,
  })
  const { isDirty, isSubmitting } = form.formState
  const tiers = form.watch('tiers')

  const setTiers = (next: TopUpBonusTier[]) =>
    form.setValue('tiers', sortTopUpBonusTiers(next), {
      shouldDirty: true,
      shouldValidate: true,
    })

  async function onSubmit(values: Values) {
    const next: Record<string, string> = {
      enabled: String(values.enabled),
      title: values.title.trim(),
      description: values.description.trim(),
      start_time: String(toSeconds(values.start)),
      end_time: String(toSeconds(values.end)),
      tiers: JSON.stringify(values.tiers),
    }
    const previous: Record<string, string> = {
      enabled: String(initial.enabled),
      title: initial.title,
      description: initial.description,
      start_time: String(toSeconds(initial.start)),
      end_time: String(toSeconds(initial.end)),
      tiers: JSON.stringify(initial.tiers),
    }
    // Save the tiers before the switch so a campaign is never enabled
    // with tiers the server rejected.
    const order = ['tiers', 'title', 'description', 'start_time', 'end_time', 'enabled']
    const updates = order.filter((field) => next[field] !== previous[field])
    if (updates.length === 0) {
      toast.info(t('No changes to save'))
      return
    }
    for (const field of updates) {
      await updateOption.mutateAsync({ key: `${KEY}.${field}`, value: next[field] })
    }
    form.reset(values)
  }

  return (
    <SettingsSection title={t('Top-up Bonus')}>
      <Form {...form}>
        <SettingsForm onSubmit={form.handleSubmit(onSubmit)} autoComplete='off'>
          <SettingsPageFormActions
            onSave={form.handleSubmit(onSubmit)}
            isSaving={updateOption.isPending || isSubmitting}
            isSaveDisabled={!isDirty}
            saveLabel='Save top-up bonus settings'
          />
          <FormField
            control={form.control}
            name='enabled'
            render={({ field }) => (
              <SettingsSwitchItem>
                <SettingsSwitchContent>
                  <FormLabel>{t('Enable top-up bonus')}</FormLabel>
                  <FormDescription>
                    {t(
                      'Each wallet top-up earns the highest tier it reaches. Users see the campaign on the wallet and at /activities.'
                    )}
                  </FormDescription>
                </SettingsSwitchContent>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    aria-label={t('Enable top-up bonus')}
                  />
                </FormControl>
              </SettingsSwitchItem>
            )}
          />

          <FormField
            control={form.control}
            name='title'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Campaign title')}</FormLabel>
                <FormControl>
                  <Input placeholder={t('Top-up Bonus')} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Campaign description')}</FormLabel>
                <FormControl>
                  <Textarea rows={4} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className='grid gap-6 sm:grid-cols-2'>
            <FormField
              control={form.control}
              name='start'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Start time')}</FormLabel>
                  <FormControl>
                    <DateTimePicker
                      value={field.value ?? undefined}
                      onChange={(date) => field.onChange(date ?? null)}
                      placeholder={t('Starts immediately')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name='end'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('End time')}</FormLabel>
                  <FormControl>
                    <DateTimePicker
                      value={field.value ?? undefined}
                      onChange={(date) => field.onChange(date ?? null)}
                      placeholder={t('No end time')}
                    />
                  </FormControl>
                  <FormDescription>
                    {t('Orders created inside this window earn the bonus.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name='tiers'
            render={() => (
              <FormItem>
                <div className='flex items-center justify-between gap-3'>
                  <FormLabel>{t('Bonus tiers')}</FormLabel>
                  <Button
                    type='button'
                    size='sm'
                    onClick={() => {
                      setEditing(null)
                      setDialogOpen(true)
                    }}
                  >
                    <Plus className='h-4 w-4' />
                    {t('Add bonus tier')}
                  </Button>
                </div>
                {tiers.length === 0 ? (
                  <div className='text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm'>
                    {t('No bonus tiers yet.')}
                  </div>
                ) : (
                  <StaticDataTable
                    data={tiers}
                    getRowKey={(tier) => tier.min_amount}
                    columns={[
                      {
                        id: 'min-amount',
                        header: t('Single top-up'),
                        cell: (tier) => `≥ ${formatCurrencyFromUSD(tier.min_amount)}`,
                      },
                      {
                        id: 'reward',
                        header: t('Bonus'),
                        cell: (tier) =>
                          tier.type === 'percent' && tier.max_bonus
                            ? `${tierReward(tier, t)} (${t('Up to {{amount}}', { amount: formatCurrencyFromUSD(tier.max_bonus) })})`
                            : tierReward(tier, t),
                      },
                      {
                        id: 'actions',
                        header: t('Actions'),
                        className: 'text-right',
                        cellClassName: 'text-right',
                        cell: (tier) => (
                          <StaticRowActions
                            editLabel={t('Edit')}
                            deleteLabel={t('Delete')}
                            menuLabel={t('Open menu')}
                            onEdit={() => {
                              setEditing(tier)
                              setDialogOpen(true)
                            }}
                            onDelete={() =>
                              setTiers(tiers.filter((item) => item !== tier))
                            }
                          />
                        ),
                      },
                    ]}
                  />
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </SettingsForm>
      </Form>

      <TopUpBonusTierDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editData={editing}
        takenAmounts={tiers
          .filter((tier) => tier !== editing)
          .map((tier) => tier.min_amount)}
        onSave={(tier) =>
          setTiers([...tiers.filter((item) => item !== editing), tier])
        }
      />
    </SettingsSection>
  )
}
