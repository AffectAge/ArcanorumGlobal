import { Listbox, Transition } from "@headlessui/react";
import { ChevronDown, Check } from "lucide-react";
import { Fragment } from "react";

export type CustomSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type CustomSelectProps = {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
  optionsClassName?: string;
};

export function CustomSelect({
  value,
  options,
  onChange,
  placeholder = "Выберите значение",
  disabled = false,
  className = "",
  buttonClassName = "",
  optionsClassName = "",
}: CustomSelectProps) {
  const selected = options.find((opt) => opt.value === value);

  return (
    <div className={`relative ${className}`}>
      <Listbox value={value} onChange={onChange} disabled={disabled}>
        <Listbox.Button
          className={`panel-border flex h-10 w-full items-center justify-between rounded-lg bg-black/35 px-3 text-left text-sm text-white outline-none transition hover:border-arc-accent/35 disabled:cursor-not-allowed disabled:opacity-60 ${buttonClassName}`}
        >
          <span className={selected ? "truncate text-white" : "truncate text-white/45"}>
            {selected?.label ?? placeholder}
          </span>
          <ChevronDown size={15} className="ml-2 shrink-0 text-white/50" />
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options
            className={`arc-scrollbar panel-border absolute z-[260] mt-1 max-h-64 w-full overflow-auto rounded-lg bg-black p-1 text-sm shadow-2xl ${optionsClassName}`}
          >
            {options.length === 0 && (
              <div className="px-2 py-2 text-xs text-white/45">Нет вариантов</div>
            )}
            {options.map((option) => (
              <Listbox.Option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className={({ active, disabled: optionDisabled }) =>
                  `relative flex cursor-pointer items-center rounded-md px-2 py-2 pr-8 text-sm transition ${
                    optionDisabled
                      ? "cursor-not-allowed text-white/30"
                      : active
                        ? "bg-arc-accent/20 text-arc-accent"
                        : "text-white/85 hover:bg-white/5"
                  }`
                }
              >
                {({ selected: isSelected }) => (
                  <>
                    <span className={isSelected ? "truncate font-semibold" : "truncate"}>{option.label}</span>
                    {isSelected && (
                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-arc-accent">
                        <Check size={14} />
                      </span>
                    )}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </Listbox>
    </div>
  );
}
