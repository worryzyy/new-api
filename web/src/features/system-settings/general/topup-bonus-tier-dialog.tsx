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
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import * as z from 'zod'

import { Dialog } from '@/components/dialog'
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
import type { TopUpBonusTier } from '@/features/activities/types'

const createTierSchema = (t: (key: string) => string, takenAmounts: number[]) =>
  z
    .object({
      min_amount: z
        .number()
        .positive(t('Amount must be greater than 0'))
        .refine((value) => !takenAmounts.includes(value), {
          message: t('Another tier already uses this amount'),
        }),
      type: z.enum(['fixed', 'percent']),
      value: z.number().positive(t('The bonus must be greater than 0')),
      max_bonus: z.number().min(0, t('The cap cannot be negative')),
    })
    .refine((tier) => tier.type !== 'percent' || tier.value <= 100, {
      message: t('A percentage bonus cannot exceed 100%'),
      path: ['value'],
    })

type TierFormValues = z.infer<ReturnType<typeof createTierSchema>>

const TIER_FORM_ID = 'topup-bonus-tier-form'
const EMPTY_TIER: TierFormValues = {
  min_amount: 0,
  type: 'fixed',
  value: 0,
  max_bonus: 0,
}

type TopUpBonusTierDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (tier: TopUpBonusTier) => void
  editData: TopUpBonusTier | null
  /** Minimum amounts already used by the other tiers. */
  takenAmounts: number[]
}

export function TopUpBonusTierDialog(props: TopUpBonusTierDialogProps) {
  const { t } = useTranslation()
  const form = useForm<TierFormValues>({
    resolver: zodResolver(createTierSchema(t, props.takenAmounts)),
    defaultValues: EMPTY_TIER,
  })
  const type = form.watch('type')

  useEffect(() => {
    form.reset(
      props.editData
        ? { ...props.editData, max_bonus: props.editData.max_bonus ?? 0 }
        : EMPTY_TIER
    )
  }, [props.editData, props.open, form])

  const handleSubmit = (values: TierFormValues) => {
    props.onSave(
      values.type === 'fixed'
        ? { min_amount: values.min_amount, type: 'fixed', value: values.value }
        : values
    )
    props.onOpenChange(false)
  }

  const numberField = (value: string) => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.editData ? t('Edit bonus tier') : t('Add bonus tier')}
      description={t(
        'A single top-up that reaches the minimum amount earns this bonus.'
      )}
      contentClassName='sm:max-w-[500px]'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <>
          <Button
            type='button'
            variant='outline'
            onClick={() => props.onOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button type='submit' form={TIER_FORM_ID}>
            {props.editData ? t('Update') : t('Add')}
          </Button>
        </>
      }
    >
      <Form {...form}>
        <form
          id={TIER_FORM_ID}
          onSubmit={form.handleSubmit(handleSubmit)}
          className='space-y-4'
        >
          <FormField
            control={form.control}
            name='min_amount'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Minimum single top-up (USD)')}</FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step='any'
                    min='0'
                    {...field}
                    onChange={(e) => field.onChange(numberField(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='type'
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('Bonus type')}</FormLabel>
                <Select
                  items={[
                    { value: 'fixed', label: t('Fixed amount') },
                    { value: 'percent', label: t('Percentage of the top-up') },
                  ]}
                  value={field.value}
                  onValueChange={(value) => field.onChange(value)}
                >
                  <FormControl>
                    <SelectTrigger className='w-full' aria-label={t('Bonus type')}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      <SelectItem value='fixed'>{t('Fixed amount')}</SelectItem>
                      <SelectItem value='percent'>
                        {t('Percentage of the top-up')}
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
            name='value'
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {type === 'fixed' ? t('Bonus (USD)') : t('Bonus (%)')}
                </FormLabel>
                <FormControl>
                  <Input
                    type='number'
                    step='any'
                    min='0'
                    {...field}
                    onChange={(e) => field.onChange(numberField(e.target.value))}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {type === 'percent' ? (
            <FormField
              control={form.control}
              name='max_bonus'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('Bonus cap (USD)')}</FormLabel>
                  <FormControl>
                    <Input
                      type='number'
                      step='any'
                      min='0'
                      {...field}
                      onChange={(e) =>
                        field.onChange(numberField(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormDescription>
                    {t('The most one top-up can earn. Set to 0 for no cap.')}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          ) : null}
        </form>
      </Form>
    </Dialog>
  )
}
