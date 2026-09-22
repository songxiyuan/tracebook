import { createRouter, createWebHistory } from 'vue-router'
import CaseList from './pages/CaseList.vue'
import CaseDetail from './pages/CaseDetail.vue'

export const router = createRouter({
  history: createWebHistory('/tracebook/'),
  routes: [
    { path: '/', name: 'cases', component: CaseList },
    { path: '/cases/:id', name: 'case', component: CaseDetail },
  ],
})
