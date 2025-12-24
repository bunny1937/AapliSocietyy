class ApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;

    const config = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include", // ← Sends HttpOnly cookies automatically
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("user");
          window.location.href = "/auth/login";
        }
        throw new Error("Unauthorized");
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || data.message || "Request failed");
        }
        return data;
      }

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return response;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  get(endpoint) {
    return this.request(endpoint, { method: "GET" });
  }

  post(endpoint, body) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  put(endpoint, body) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: "DELETE" });
  }

  async upload(endpoint, formData) {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include", // ← Send cookies
        body: formData, // Don't set Content-Type for FormData
      });

      if (response.status === 401) {
        if (typeof window !== "undefined") {
          localStorage.removeItem("user");
          window.location.href = "/auth/login";
        }
        throw new Error("Unauthorized");
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      return data;
    } catch (error) {
      console.error(`Upload Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async download(endpoint, filename) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      credentials: "include", // ← Send cookies
    });

    if (!response.ok) {
      throw new Error("Download failed");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

export const apiClient = new ApiClient();
