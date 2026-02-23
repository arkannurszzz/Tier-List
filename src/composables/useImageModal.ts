import { ref } from 'vue'

const activeImage = ref<{ src: string; name?: string } | null>(null)

export function useImageModal() {
  function openModal(src: string, name?: string) {
    activeImage.value = { src, name }
  }

  function closeModal() {
    activeImage.value = null
  }

  return { activeImage, openModal, closeModal }
}
