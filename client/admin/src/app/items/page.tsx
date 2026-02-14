'use client'

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/layout/AdminLayout';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Input,
} from '@heroui/react';
import { Search, Eye, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import type { Item } from '@/types';

const categories = [
  'SCHOOL_ATTIRE',
  'ACADEMIC_TOOLS',
  'ELECTRONICS',
  'DEVELOPMENT_KITS',
  'MEASUREMENT_TOOLS',
  'AUDIO_VISUAL',
  'SPORTS_EQUIPMENT',
  'OTHER',
];

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      const response = await api.get('/items');
      setItems(response.data.data?.items || []);
    } catch (error) {
      console.error('Failed to fetch items:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteItem = async (itemId: string) => {
    if (confirm('Are you sure you want to delete this item?')) {
      try {
        await api.delete(`/items/${itemId}`);
        fetchItems();
      } catch (error) {
        console.error('Failed to delete item:', error);
      }
    }
  };

  const filteredItems = items.filter(item =>
    (item.title.toLowerCase().includes(search.toLowerCase()) ||
    item.description.toLowerCase().includes(search.toLowerCase())) &&
    (categoryFilter === '' || item.category === categoryFilter)
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Item Management</h1>
          <div className="flex gap-4">
            <select
              className="px-3 py-2 border rounded-lg max-w-xs bg-white"
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <Input
              placeholder="Search items..."
              startContent={<Search size={18} />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
            />
          </div>
        </div>

        <Table aria-label="Items table">
          <TableHeader>
            <TableColumn>TITLE</TableColumn>
            <TableColumn>CATEGORY</TableColumn>
            <TableColumn>CONDITION</TableColumn>
            <TableColumn>PRICE/DAY</TableColumn>
            <TableColumn>OWNER</TableColumn>
            <TableColumn>STATUS</TableColumn>
            <TableColumn>ACTIONS</TableColumn>
          </TableHeader>
          <TableBody>
            {filteredItems.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.title}</TableCell>
                <TableCell>{item.category.replace(/_/g, ' ')}</TableCell>
                <TableCell>{item.condition}</TableCell>
                <TableCell>₱{item.pricePerDay}</TableCell>
                <TableCell>{item.owner.firstName} {item.owner.lastName}</TableCell>
                <TableCell>
                  <Chip color={item.isAvailable ? 'success' : 'warning'} size="sm">
                    {item.isAvailable ? 'Available' : 'Rented'}
                  </Chip>
                </TableCell>
                <TableCell>
                  <div className="flex gap-2">
                    <Button size="sm" color="primary" variant="flat" startContent={<Eye size={16} />}>
                      View
                    </Button>
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      startContent={<Trash2 size={16} />}
                      onClick={() => deleteItem(item.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
