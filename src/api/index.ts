import type { Sword, Swordsman, Sect, ApiResponse, SwordListResponse, SwordFilterParams } from '../types';
import { registerSwords } from '../audio/jianmingCore';

const API_BASE = '/api';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, init);
  const data: ApiResponse<T> = await response.json();

  if (data.code !== 200) {
    throw new Error(data.message);
  }

  return data.data;
}

export const swordApi = {
  getSwords: async (params: SwordFilterParams = {}): Promise<SwordListResponse> => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        query.append(key, String(value));
      }
    });
    const queryString = query.toString();
    const res = await request<SwordListResponse>(`/swords${queryString ? `?${queryString}` : ''}`);
    registerSwords(res.list); // 注册进剑鸣核心，供 window.JianMing.params(id) 断言
    return res;
  },

  getPopularSwords: async (limit?: number): Promise<Sword[]> => {
    const query = limit ? `?limit=${limit}` : '';
    const res = await request<Sword[]>(`/swords/popular${query}`);
    registerSwords(res);
    return res;
  },

  getSwordById: async (id: string): Promise<Sword> => {
    const res = await request<Sword>(`/swords/${id}`);
    registerSwords([res]);
    return res;
  },
};

export const swordsmanApi = {
  getSwordsmen: (limit?: number): Promise<Swordsman[]> => {
    const query = limit ? `?limit=${limit}` : '';
    return request<Swordsman[]>(`/swordsmen${query}`);
  },
  
  getLatestSwordsmen: (limit?: number): Promise<Swordsman[]> => {
    const query = limit ? `?limit=${limit}` : '';
    return request<Swordsman[]>(`/swordsmen/latest${query}`);
  },
  
  getSwordsmanById: (id: string): Promise<Swordsman> => {
    return request<Swordsman>(`/swordsmen/${id}`);
  },
};

export const sectApi = {
  getSects: (limit?: number): Promise<Sect[]> => {
    const query = limit ? `?limit=${limit}` : '';
    return request<Sect[]>(`/sects${query}`);
  },
  
  getPopularSects: (limit?: number): Promise<Sect[]> => {
    const query = limit ? `?limit=${limit}` : '';
    return request<Sect[]>(`/sects/popular${query}`);
  },
  
  getSectById: (id: string): Promise<Sect> => {
    return request<Sect>(`/sects/${id}`);
  },
};
