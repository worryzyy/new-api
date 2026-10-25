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
import type { Table } from '@tanstack/react-table'
import { useTranslation } from 'react-i18next'

import { Combobox } from '@/components/ui/combobox'
import { CompactDateTimeRangePicker } from '@/features/usage-logs/components/compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from '@/features/usage-logs/components/logs-filter-toolbar'

import type { ModerationLog, ModerationLogFilters } from '../api'

const ENDPOINTS = [
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
  '/v1/completions',
  '/v1/images/generations',
  '/v1/images/edits',
]

function FilterSelect(props: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <LogsFilterField>
      <Combobox
        options={props.options}
        value={props.value}
        onValueChange={(value) => {
          if (value !== null) props.onChange(value)
        }}
        aria-label={props.label}
        className='w-full'
      />
    </LogsFilterField>
  )
}

export function ModerationLogFilterBar(props: {
  table: Table<ModerationLog>
  filters: ModerationLogFilters
  groups: string[]
  onChange: (patch: Partial<ModerationLogFilters>) => void
  isFetching: boolean
  onSearch: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const dateFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={
          props.filters.start_timestamp === undefined
            ? undefined
            : new Date(props.filters.start_timestamp * 1000)
        }
        end={
          props.filters.end_timestamp === undefined
            ? undefined
            : new Date(props.filters.end_timestamp * 1000)
        }
        onChange={({ start, end }) =>
          props.onChange({
            start_timestamp: start
              ? Math.floor(start.getTime() / 1000)
              : undefined,
            end_timestamp: end ? Math.floor(end.getTime() / 1000) : undefined,
          })
        }
      />
    </LogsFilterField>
  )
  const mainFilters = (
    <>
      <FilterSelect
        label={t('Result')}
        value={props.filters.result ?? 'all'}
        options={[
          { value: 'all', label: t('All results') },
          { value: 'hit', label: t('Hit') },
          { value: 'blocked', label: t('Blocked') },
          { value: 'cyber_policy', label: t('Cyber policy') },
          { value: 'judge', label: t('LLM judge hit') },
          { value: 'pass', label: t('Passed') },
          { value: 'error', label: t('Moderation error') },
        ]}
        onChange={(value) =>
          props.onChange({ result: value === 'all' ? undefined : value })
        }
      />
      <FilterSelect
        label={t('Group')}
        value={props.filters.group ?? 'all'}
        options={[
          { value: 'all', label: t('All groups') },
          ...props.groups.map((group) => ({ value: group, label: group })),
        ]}
        onChange={(value) =>
          props.onChange({ group: value === 'all' ? undefined : value })
        }
      />
    </>
  )
  const advancedFilters = (
    <>
      <FilterSelect
        label={t('Endpoint')}
        value={props.filters.endpoint ?? 'all'}
        options={[
          { value: 'all', label: t('All endpoints') },
          ...ENDPOINTS.map((endpoint) => ({
            value: endpoint,
            label: endpoint,
          })),
        ]}
        onChange={(value) =>
          props.onChange({ endpoint: value === 'all' ? undefined : value })
        }
      />
      <LogsFilterField>
        <LogsFilterInput
          aria-label={t('Search')}
          placeholder={t('Request ID, user, key, model or input')}
          value={props.filters.search ?? ''}
          onChange={(event) =>
            props.onChange({ search: event.target.value || undefined })
          }
        />
      </LogsFilterField>
    </>
  )
  const advancedCount = [props.filters.endpoint, props.filters.search].filter(
    Boolean
  ).length
  const filterCount =
    advancedCount +
    [props.filters.result, props.filters.group].filter(Boolean).length
  return (
    <LogsFilterToolbar
      table={props.table}
      primaryFilters={
        <>
          {dateFilter}
          {mainFilters}
        </>
      }
      advancedFilters={advancedFilters}
      mobilePinnedFilters={dateFilter}
      mobileFilters={
        <>
          {mainFilters}
          {advancedFilters}
        </>
      }
      mobileFilterCount={filterCount}
      advancedFilterCount={advancedCount}
      hasActiveFilters={
        filterCount > 0 ||
        props.filters.start_timestamp !== undefined ||
        props.filters.end_timestamp !== undefined
      }
      hasAdvancedActiveFilters={advancedCount > 0}
      searchLoading={props.isFetching}
      onSearch={props.onSearch}
      onReset={props.onReset}
    />
  )
}
