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
import { useEffect, useState } from 'react'
import { useForm, type Resolver } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { StaticDataTable } from '@/components/data-table/static/static-data-table'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { RichContent } from '@/components/rich-content'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  sortTopUpBonusTiers,
  tierReward,
} from '@/features/activities/lib/bonus'
import type { TopUpBonusTier } from '@/features/activities/types'
import { formatCurrencyFromUSD } from '@/lib/currency'

import { useCampaign, useCampaignAction } from './api'
import { BonusTierDialog } from './bonus-tier-dialog'
import type { CampaignInput } from './types'

/** Matches the server's page size limit. */
const MAX_CONTENT_BYTES = 512 * 1024
const FORM_ID = 'campaign-form'

type Values = {
  title: string
  content: string
  start: Date | null
  end: Date | null
  tiers: TopUpBonusTier[]
}

const EMPTY_VALUES: Values = {
  title: '',
  content: '',
  start: null,
  end: null,
  tiers: [],
}

function createSchema(t: (key: string) => string) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t('Enter a campaign title'))
        .max(100, t('The title can be at most 100 characters')),
      content: z
        .string()
        .refine(
          (value) =>
            new TextEncoder().encode(value).length <= MAX_CONTENT_BYTES,
          t('The campaign page can be at most 512 KB')
        ),
      start: z.date().nullable(),
      end: z.date().nullable(),
      tiers: z.array(z.custom<TopUpBonusTier>()),
    })
    .refine((v) => !v.start || !v.end || v.end > v.start, {
      message: t('The end time must be after the start time'),
      path: ['end'],
    })
}

const toDate = (seconds: number) =>
  seconds > 0 ? new Date(seconds * 1000) : null
const toSeconds = (date: Date | null) =>
  date ? Math.floor(date.getTime() / 1000) : 0

type CampaignFormDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The campaign to edit; null creates one. */
  campaignId: number | null
}

export function CampaignFormDialog(props: CampaignFormDialogProps) {
  const { t } = useTranslation()
  const editing = useCampaign(props.open ? props.campaignId : null)
  const action = useCampaignAction()
  const [tierDialogOpen, setTierDialogOpen] = useState(false)
  const [editingTier, setEditingTier] = useState<TopUpBonusTier | null>(null)

  const form = useForm<Values>({
    resolver: zodResolver(createSchema(t)) as unknown as Resolver<Values>,
    defaultValues: EMPTY_VALUES,
  })
  const tiers = form.watch('tiers')
  const content = form.watch('content')

  const loaded = editing.data
  useEffect(() => {
    if (!props.open) return
    if (props.campaignId === null) {
      form.reset(EMPTY_VALUES)
      return
    }
    if (!loaded) return
    form.reset({
      title: loaded.title,
      content: loaded.content,
      start: toDate(loaded.start_time),
      end: toDate(loaded.end_time),
      tiers: sortTopUpBonusTiers(loaded.bonus_tiers),
    })
  }, [props.open, props.campaignId, loaded, form])

  const setTiers = (next: TopUpBonusTier[]) =>
    form.setValue('tiers', sortTopUpBonusTiers(next), { shouldDirty: true })

  async function onSubmit(values: Values) {
    const input: CampaignInput = {
      title: values.title.trim(),
      content: values.content,
      start_time: toSeconds(values.start),
      end_time: toSeconds(values.end),
      bonus_tiers: values.tiers,
    }
    const saved = await action.mutateAsync(
      props.campaignId === null
        ? { kind: 'create', input }
        : { kind: 'update', id: props.campaignId, input }
    )
    if (saved) props.onOpenChange(false)
  }

  const loading = props.campaignId !== null && editing.isLoading

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.campaignId === null ? t('New campaign') : t('Edit campaign')}
      description={t(
        'Only the published campaign is shown to users. Its bonus tiers apply to wallet top-ups created while it is live.'
      )}
      contentClassName='sm:max-w-4xl'
      bodyClassName='space-y-5'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button
            type='submit'
            form={FORM_ID}
            disabled={loading || action.isPending}
          >
            {t('Save')}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          {t('Loading...')}
        </div>
      ) : (
        <Form {...form}>
          <form
            id={FORM_ID}
            onSubmit={form.handleSubmit(onSubmit)}
            className='space-y-5'
            autoComplete='off'
          >
            <FormField
              control={form.control}
              name='title'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Campaign title')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormDescription>
                    {t('Shown on the wallet banner and in the admin list.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className='grid gap-5 sm:grid-cols-2'>
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
                        placeholder={t('Starts when published')}
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
                      {t(
                        'Past the end time the campaign is hidden and grants no bonus.'
                      )}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name='content'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Campaign page')}</FormLabel>
                  <Tabs defaultValue='edit'>
                    <TabsList>
                      <TabsTrigger value='edit'>{t('HTML')}</TabsTrigger>
                      <TabsTrigger value='preview'>{t('Preview')}</TabsTrigger>
                    </TabsList>
                    <TabsContent value='edit'>
                      <FormControl>
                        <Textarea
                          rows={14}
                          className='font-mono text-xs'
                          placeholder='<section>...</section>'
                          {...field}
                        />
                      </FormControl>
                    </TabsContent>
                    <TabsContent value='preview'>
                      <div className='max-h-[60vh] overflow-auto rounded-lg border'>
                        {content.trim() ? (
                          <RichContent
                            mode='html'
                            htmlVariant='isolated'
                            content={content}
                          />
                        ) : (
                          <div className='text-muted-foreground p-6 text-center text-sm'>
                            {t(
                              'Without a page, users see the title, period and bonus tiers.'
                            )}
                          </div>
                        )}
                      </div>
                    </TabsContent>
                  </Tabs>
                  <FormDescription>
                    {t(
                      'Users see this page at /activities. Styles, images and video are kept; scripts are removed.'
                    )}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                      variant='outline'
                      onClick={() => {
                        setEditingTier(null)
                        setTierDialogOpen(true)
                      }}
                    >
                      <Plus className='h-4 w-4' />
                      {t('Add bonus tier')}
                    </Button>
                  </div>
                  <StaticDataTable
                    data={tiers}
                    getRowKey={(tier) => tier.min_amount}
                    emptyClassName='text-sm'
                    emptyContent={t(
                      'No bonus tiers. The campaign only shows its page.'
                    )}
                    columns={[
                      {
                        id: 'min-amount',
                        header: t('Single top-up'),
                        cell: (tier) =>
                          `≥ ${formatCurrencyFromUSD(tier.min_amount)}`,
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
                              setEditingTier(tier)
                              setTierDialogOpen(true)
                            }}
                            onDelete={() =>
                              setTiers(tiers.filter((item) => item !== tier))
                            }
                          />
                        ),
                      },
                    ]}
                  />
                  <FormDescription>
                    {t('Each wallet top-up earns the highest tier it reaches.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>
      )}

      <BonusTierDialog
        open={tierDialogOpen}
        onOpenChange={setTierDialogOpen}
        editData={editingTier}
        takenAmounts={tiers
          .filter((tier) => tier !== editingTier)
          .map((tier) => tier.min_amount)}
        onSave={(tier) =>
          setTiers([...tiers.filter((item) => item !== editingTier), tier])
        }
      />
    </Dialog>
  )
}
