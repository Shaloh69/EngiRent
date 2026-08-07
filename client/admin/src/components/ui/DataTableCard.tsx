"use client";

import {
  Card,
  Center,
  Group,
  Loader,
  ScrollArea,
  Select,
  Table,
  TextInput,
} from "@mantine/core";
import { Search } from "lucide-react";
import type { ReactNode } from "react";

interface FilterConfig {
  value: string | null;
  onChange: (value: string | null) => void;
  data: { value: string; label: string }[];
  placeholder: string;
}

interface DataTableCardProps {
  columns: string[];
  loading?: boolean;
  isEmpty?: boolean;
  emptyState?: ReactNode;
  children: ReactNode;
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  filters?: FilterConfig[];
  toolbar?: ReactNode;
}

// Shared shell for every list page: consistent toolbar, header row, loading
// and empty handling. The table header always renders even when there are no
// rows, so an empty result still reads as a table rather than a blank card.
export function DataTableCard({
  columns,
  loading,
  isEmpty,
  emptyState,
  children,
  search,
  filters,
  toolbar,
}: DataTableCardProps) {
  return (
    <Card withBorder radius="md" padding="lg">
      {(search || filters?.length || toolbar) && (
        <Group mb="md" gap="sm" wrap="wrap">
          {search && (
            <TextInput
              leftSection={<Search size={15} />}
              placeholder={search.placeholder ?? "Search…"}
              value={search.value}
              onChange={(e) => search.onChange(e.currentTarget.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
          )}
          {filters?.map((f, i) => (
            <Select
              key={i}
              placeholder={f.placeholder}
              data={f.data}
              value={f.value}
              onChange={f.onChange}
              clearable
              w={190}
            />
          ))}
          {toolbar}
        </Group>
      )}

      <ScrollArea>
        <Table highlightOnHover verticalSpacing="sm" miw={720}>
          <Table.Thead>
            <Table.Tr>
              {columns.map((c) => (
                <Table.Th key={c}>{c}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {!loading && !isEmpty && children}
          </Table.Tbody>
        </Table>
      </ScrollArea>

      {loading && (
        <Center mih={160}>
          <Loader size="sm" />
        </Center>
      )}
      {!loading && isEmpty && emptyState}
    </Card>
  );
}
