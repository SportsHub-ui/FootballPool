type ColorPickerFieldProps = {
  label: string
  value: string
  onChange: (nextValue: string) => void
  disabled?: boolean
  placeholder?: string
  suggestedColors?: string[]
}

const DEFAULT_SWATCHES = ['#0B162A', '#E31837', '#004C54', '#4F2683', '#203731', '#0076B6', '#97233F', '#FFB81C']
const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

const normalizeHex = (value: string): string => {
  const trimmed = value.trim().toUpperCase()
  if (!trimmed) {
    return ''
  }

  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

const getSafeColorValue = (value: string): string => {
  const normalized = normalizeHex(value)
  return HEX_COLOR_PATTERN.test(normalized) ? normalized : '#8A8F98'
}

export function ColorPickerField({
  label,
  value,
  onChange,
  disabled = false,
  placeholder = '#0B162A',
  suggestedColors = DEFAULT_SWATCHES
}: ColorPickerFieldProps) {
  const normalizedValue = normalizeHex(value)
  const colorValue = getSafeColorValue(value)

  return (
    <label className="field-block color-picker-block">
      <span>{label}</span>
      <div className="color-picker-field">
        <div className="color-picker-input-row">
          <input
            type="color"
            className="color-picker-native"
            value={colorValue}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            disabled={disabled}
            aria-label={`${label} picker`}
          />
          <input
            type="text"
            className="color-picker-text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onBlur={() => {
              if (normalizedValue && HEX_COLOR_PATTERN.test(normalizedValue)) {
                onChange(normalizedValue)
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
          />
          <span className="color-picker-preview" style={{ backgroundColor: colorValue }} aria-hidden="true" />
        </div>

        <div className="color-picker-swatches">
          {suggestedColors.map((color) => (
            <button
              key={`${label}-${color}`}
              type="button"
              className={`color-picker-swatch ${normalizeHex(value) === color ? 'is-selected' : ''}`}
              style={{ backgroundColor: color }}
              onClick={() => onChange(color)}
              disabled={disabled}
              title={color}
              aria-label={`Use ${color} for ${label}`}
            />
          ))}
        </div>
      </div>
    </label>
  )
}
