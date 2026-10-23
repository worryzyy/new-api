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
import type { UseQueryResult } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { DataTablePage, useDataTable } from '@/components/data-table'

import type { ModerationLog, ModerationLogFilters } from '../api'
import { useModerationLogColumns } from './moderation-log-columns'
import { ModerationLogFilterBar } from './moderation-log-filter-bar'

const EMPTY_LOGS: ModerationLog[] = []

export function ModerationLogViewer(props: {
  query: UseQueryResult<{ items: ModerationLog[]; total: number }>
  filters: ModerationLogFilters
  setFilters: Dispatch<SetStateAction<ModerationLogFilters>>
  groups: string[]
}) {
  const { t } = useTranslation()
  const query = props.query
  const columns = useModerationLogColumns()
  const { table } = useDataTable({
    columns,
    data: query.isError ? EMPTY_LOGS : (query.data?.items ?? EMPTY_LOGS),
    getRowId: (entry) => String(entry.id),
    totalCount: query.isError ? 0 : (query.data?.total ?? 0),
    pagination: {
      pageIndex: props.filters.p - 1,
      pageSize: props.filters.page_size,
    },
    onPaginationChange: (updater) => {
      if (query.isFetching) return
      props.setFilters((previous) => {
        const current = {
          pageIndex: previous.p - 1,
          pageSize: previous.page_size,
        }
        const next = typeof updater === 'function' ? updater(current) : updater
        return {
          ...previous,
          p: next.pageSize === previous.page_size ? next.pageIndex + 1 : 1,
          page_size: next.pageSize,
        }
      })
    },
    enableRowSelection: false,
    enableSorting: false,
    manualFiltering: true,
    manualPagination: true,
  })

  return (
    <DataTablePage
      table={table}
      columns={columns}
      isLoading={query.isPending}
      isFetching={query.isFetching}
      emptyTitle={
        query.isError
          ? t('Failed to load content moderation records')
          : t('No records')
      }
      paginationInFooter
      className='h-auto min-h-[420px]'
      applyHeaderSize
      getColumnClassName={() => 'py-2'}
      toolbar={
        <ModerationLogFilterBar
          table={table}
          filters={props.filters}
          groups={props.groups}
          onChange={(patch) =>
            props.setFilters((previous) => ({ ...previous, ...patch, p: 1 }))
          }
          isFetching={query.isFetching}
          onSearch={() => void query.refetch()}
          onReset={() =>
            props.setFilters({ p: 1, page_size: props.filters.page_size })
          }
        />
      }
    />
  )
}
