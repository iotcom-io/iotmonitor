import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'
import { execSync } from 'child_process'

const gitSha = () => {
    try {
        return execSync('git rev-parse --short HEAD').toString().trim()
    } catch {
        return 'nogit'
    }
}

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        proxy: {
            '/api': 'http://localhost:5001',
            '/socket.io': {
                target: 'http://localhost:5001',
                ws: true
            }
        }
    },
    define: {
        'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || pkg.version || 'dev'),
        'import.meta.env.VITE_APP_BUILD': JSON.stringify(process.env.VITE_APP_BUILD || gitSha()),
    }
})
