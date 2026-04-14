import axios from 'axios';

const BASE = 'https://apigateway-educacao.paas.pr.gov.br/seed/rcdig/estadual/v1';

export class RcoApiService {
    #tokenService = null;

    initialize(tokenService) {
        this.#tokenService = tokenService;
    }

    async #headers() {
        const token = await this.#tokenService.getValidToken();
        return { consumerId: 'RCDIGWEB', Authorization: `Bearer ${token}` };
    }

    async get(path) {
        const headers = await this.#headers();
        let response = await axios.get(BASE + path, { headers, timeout: 30000, validateStatus: () => true });

        if (response.status === 401 || response.status === 403) {
            const newHeaders = await this.#refreshHeaders();
            response = await axios.get(BASE + path, { headers: newHeaders, timeout: 30000, validateStatus: () => true });
        }

        return response;
    }

    async #refreshHeaders() {
        const token = await this.#tokenService.getValidToken(true);
        return { consumerId: 'RCDIGWEB', Authorization: `Bearer ${token}` };
    }

    async getRawFull(path) {
        const fullBase = 'https://apigateway-educacao.paas.pr.gov.br/seed/rcdig';
        const headers = await this.#headers();
        return axios.get(fullBase + path, { headers, timeout: 20000, validateStatus: () => true });
    }

    async put(path, body, extraHeaders = {}) {
        const headers = await this.#headers();
        const all = { ...headers, 'Content-Type': 'application/json', ...extraHeaders };
        let response = await axios.put(BASE + path, body, { headers: all, timeout: 30000, validateStatus: () => true });
        if (response.status === 401 || response.status === 403) {
            const newH = await this.#refreshHeaders();
            const all2 = { ...newH, 'Content-Type': 'application/json', ...extraHeaders };
            response = await axios.put(BASE + path, body, { headers: all2, timeout: 30000, validateStatus: () => true });
        }
        return response;
    }

    async post(path, body, extraHeaders = {}) {
        const headers = await this.#headers();
        const all = { ...headers, 'Content-Type': 'application/json', ...extraHeaders };
        let response = await axios.post(BASE + path, body, { headers: all, timeout: 30000, validateStatus: () => true });
        if (response.status === 401 || response.status === 403) {
            const newH = await this.#refreshHeaders();
            const all2 = { ...newH, 'Content-Type': 'application/json', ...extraHeaders };
            response = await axios.post(BASE + path, body, { headers: all2, timeout: 30000, validateStatus: () => true });
        }
        return response;
    }

    async delete(path, extraHeaders = {}) {
        const headers = await this.#headers();
        const all = { ...headers, ...extraHeaders };
        let response = await axios.delete(BASE + path, { headers: all, timeout: 30000, validateStatus: () => true });
        if (response.status === 401 || response.status === 403) {
            const newH = await this.#refreshHeaders();
            const all2 = { ...newH, ...extraHeaders };
            response = await axios.delete(BASE + path, { headers: all2, timeout: 30000, validateStatus: () => true });
        }
        return response;
    }

    async getToken() {
        return this.#tokenService.getValidToken();
    }
}

export const rcoApiService = new RcoApiService();
