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
import { useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { MultiSelect } from '@/components/multi-select'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { getGroupNames, getModelNames } from '../../api'
import type { ModerationFormValues } from '../../lib/config-form'
import { RadioCards } from './fields'

export function ScopeTab() {
  const { t } = useTranslation()
  const form = useFormContext<ModerationFormValues>()
  const allGroups = form.watch('all_groups')
  const filterType = form.watch('model_filter_type')
  const groups = useQuery({
    queryKey: ['content-moderation', 'groups'],
    queryFn: getGroupNames,
  })
  const models = useQuery({
    queryKey: ['content-moderation', 'models'],
    queryFn: getModelNames,
    enabled: filterType !== 'all',
  })

  return (
    <div className='flex flex-col gap-6'>
      <RadioCards
        legend={t('Groups')}
        className='sm:grid-cols-2'
        value={allGroups ? 'all' : 'selected'}
        options={[
          {
            value: 'all',
            label: t('All groups'),
            description: t('Every group is audited.'),
          },
          {
            value: 'selected',
            label: t('Selected groups'),
            description: t(
              'Only requests using the selected groups are audited.'
            ),
          },
        ]}
        onChange={(value) =>
          form.setValue('all_groups', value === 'all', {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      />
      {!allGroups && (
        <FormField
          control={form.control}
          name='groups'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Groups to audit')}</FormLabel>
              <MultiSelect
                options={(groups.data ?? []).map((group) => ({
                  label: group,
                  value: group,
                }))}
                selected={field.value}
                onChange={field.onChange}
                placeholder={t('Select groups')}
              />
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <RadioCards
        legend={t('Model filter')}
        value={filterType}
        options={[
          {
            value: 'all',
            label: t('All models'),
            description: t('Every model is audited.'),
          },
          {
            value: 'include',
            label: t('Only these models'),
            description: t('Audit only the selected models.'),
          },
          {
            value: 'exclude',
            label: t('Exclude these models'),
            description: t('Audit every model except the selected ones.'),
          },
        ]}
        onChange={(value) =>
          form.setValue('model_filter_type', value, {
            shouldDirty: true,
            shouldValidate: true,
          })
        }
      />
      {filterType !== 'all' && (
        <FormField
          control={form.control}
          name='model_filter_models'
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('Models')}</FormLabel>
              <MultiSelect
                options={(models.data ?? []).map((model) => ({
                  label: model,
                  value: model,
                }))}
                selected={field.value}
                onChange={field.onChange}
                allowCreate
                placeholder={t('Select or type model names')}
              />
              <FormDescription>
                {t(
                  'Matched case-insensitively against the model name the client requested.'
                )}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      <FormField
        control={form.control}
        name='exempt_user_ids'
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('Trusted user IDs')}</FormLabel>
            <FormControl>
              <Input placeholder='1, 2, 3' {...field} />
            </FormControl>
            <FormDescription>
              {t(
                'Requests from these users are checked and recorded but never blocked, and do not count toward automatic bans.'
              )}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}
