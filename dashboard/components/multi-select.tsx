"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// An empty `selected` array means "All".
export function MultiSelect({
  options,
  selected,
  onChange,
  label,
  placeholder = "Search…",
  className,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const all = selected.length === 0;

  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  const summary = all
    ? "All"
    : selected.length <= 2
      ? selected.join(", ")
      : `${selected.length} selected`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline" }),
          "w-full justify-between font-normal",
          className,
        )}
        disabled={options.length === 0}
      >
        <span className="truncate">
          <span className="text-muted-foreground">{label}: </span>
          {summary}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => onChange([])}
                className="font-medium"
              >
                <Check
                  className={cn(
                    "mr-2 size-4",
                    all ? "opacity-100" : "opacity-0",
                  )}
                />
                All
              </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              {options.map((option) => {
                const checked = selected.includes(option);
                return (
                  <CommandItem
                    key={option}
                    value={option}
                    onSelect={() => toggle(option)}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        checked ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{option}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        {!all && (
          <div className="flex flex-wrap gap-1 border-t p-2">
            {selected.map((s) => (
              <Badge
                key={s}
                variant="secondary"
                className="cursor-pointer text-xs"
                onClick={() => toggle(s)}
              >
                {s} ✕
              </Badge>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
