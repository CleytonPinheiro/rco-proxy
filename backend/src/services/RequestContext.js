/**
 * Contexto assíncrono por requisição.
 * Permite que qualquer serviço (ex: TokenService) acesse a sessão
 * do usuário atual sem que ela seja passada explicitamente.
 */
import { AsyncLocalStorage } from 'async_hooks';

export const requestContext = new AsyncLocalStorage();
