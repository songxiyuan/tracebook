import { createRouter, createWebHistory } from 'vue-router'
import CaseList from './pages/CaseList.vue'
import CaseDetail from './pages/CaseDetail.vue'
import NotFound from './pages/NotFound.vue'

const BASE_TITLE = 'Tracebook'

export const router = createRouter({
  history: createWebHistory('/tracebook/'),
  routes: [
    { path: '/', name: 'cases', component: CaseList, meta: { title: 'Cases' } },
    { path: '/cases/:id', name: 'case', component: CaseDetail },
    // A genuine 404 view instead of a silent redirect, so a stale/typo deep
    // link tells the reader what happened and offers a way back.
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound, meta: { title: 'Not found' } },
  ],
})

// Default title per route; the Case detail view refines it to the case title
// once the document loads (see CaseDetail).
router.afterEach((to) => {
  const title = to.meta?.title as string | undefined
  document.title = title ? `${title} · ${BASE_TITLE}` : BASE_TITLE
})
