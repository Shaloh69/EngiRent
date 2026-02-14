'use client'

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/layout/AdminLayout';
import { Card, CardBody, CardHeader } from '@heroui/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import api from '@/lib/api';

const monthlyData = [
  { month: 'Jan', rentals: 45, revenue: 12500 },
  { month: 'Feb', rentals: 52, revenue: 15800 },
  { month: 'Mar', rentals: 61, revenue: 18200 },
  { month: 'Apr', rentals: 48, revenue: 14300 },
  { month: 'May', rentals: 70, revenue: 21600 },
  { month: 'Jun', rentals: 58, revenue: 17900 },
];

const categoryData = [
  { category: 'Electronics', count: 45 },
  { category: 'Dev Kits', count: 32 },
  { category: 'School Attire', count: 28 },
  { category: 'Tools', count: 18 },
  { category: 'Audio/Visual', count: 12 },
];

export default function ReportsPage() {
  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Reports & Analytics</h1>

        {/* Monthly Revenue */}
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Monthly Revenue Trend</h2>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="revenue" stroke="#3b82f6" name="Revenue (₱)" />
              </LineChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Rental Trends */}
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Monthly Rentals</h2>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="rentals" fill="#10b981" name="Rentals" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>

        {/* Category Distribution */}
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Items by Category</h2>
          </CardHeader>
          <CardBody>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={categoryData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="category" type="category" width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill="#8b5cf6" name="Items" />
              </BarChart>
            </ResponsiveContainer>
          </CardBody>
        </Card>
      </div>
    </AdminLayout>
  );
}
