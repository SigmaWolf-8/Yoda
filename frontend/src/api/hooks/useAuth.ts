import { useMutation } from '@tanstack/react-query';
import apiClient, { storeTokens, clearTokens } from '../client';
import type { AuthResponse } from '../../types';

export function useRegister() {
  return useMutation({
    mutationFn: async (data: { email: string; password: string; name: string }) => {
      const res = await apiClient.post<AuthResponse>('/auth/register', data);
      return res.data;
    },
    onSuccess: (data) => {
      storeTokens(data.token, data.refresh_token, true);
    },
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: async (data: { email: string; password: string; remember?: boolean }) => {
      const { remember, ...credentials } = data;
      const res = await apiClient.post<AuthResponse>('/auth/login', credentials);
      storeTokens(res.data.token, res.data.refresh_token, remember ?? true);
      return res.data;
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout');
    },
    onSettled: () => {
      clearTokens();
      window.location.href = '/login';
    },
  });
}
