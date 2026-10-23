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
import { useId } from 'react'
import type { Control } from 'react-hook-form'

import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import {
  SettingsSwitchContent,
  SettingsSwitchItem,
} from '@/features/system-settings/components/settings-form-layout'

import type { ModerationFormValues } from '../../lib/config-form'

type FormKeys<V> = {
  [K in keyof ModerationFormValues]: ModerationFormValues[K] extends V
    ? K
    : never
}[keyof ModerationFormValues]

export function NumberField(props: {
  control: Control<ModerationFormValues>
  name: FormKeys<number>
  label: string
  description?: string
  step?: number
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
              step={props.step}
              value={Number.isFinite(field.value) ? field.value : ''}
              onChange={(event) => field.onChange(event.target.valueAsNumber)}
              onBlur={field.onBlur}
            />
          </FormControl>
          {props.description && (
            <FormDescription>{props.description}</FormDescription>
          )}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function SwitchField(props: {
  control: Control<ModerationFormValues>
  name: FormKeys<boolean>
  label: string
  description?: string
  disabled?: boolean
}) {
  return (
    <FormField
      control={props.control}
      name={props.name}
      render={({ field }) => (
        <SettingsSwitchItem>
          <SettingsSwitchContent>
            <FormLabel>{props.label}</FormLabel>
            {props.description && (
              <FormDescription>{props.description}</FormDescription>
            )}
          </SettingsSwitchContent>
          <FormControl>
            <Switch
              checked={field.value}
              disabled={props.disabled}
              onCheckedChange={field.onChange}
            />
          </FormControl>
        </SettingsSwitchItem>
      )}
    />
  )
}

export function RadioCards<T extends string>(props: {
  legend: string
  value: T
  options: { value: T; label: string; description: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  const id = useId()
  return (
    <FieldSet>
      <FieldLegend id={`${id}-legend`} variant='label'>
        {props.legend}
      </FieldLegend>
      <RadioGroup
        aria-labelledby={`${id}-legend`}
        value={props.value}
        className={props.className ?? 'sm:grid-cols-3'}
        onValueChange={(value) => {
          const option = props.options.find((item) => item.value === value)
          if (option) props.onChange(option.value)
        }}
      >
        {props.options.map((option) => (
          <FieldLabel key={option.value} htmlFor={`${id}-${option.value}`}>
            <Field orientation='horizontal'>
              <RadioGroupItem
                id={`${id}-${option.value}`}
                value={option.value}
                aria-labelledby={`${id}-${option.value}-label`}
                aria-describedby={`${id}-${option.value}-hint`}
              />
              <div className='min-w-0'>
                <span id={`${id}-${option.value}-label`}>{option.label}</span>
                <FieldDescription id={`${id}-${option.value}-hint`}>
                  {option.description}
                </FieldDescription>
              </div>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  )
}
