// Global error handler for the application
export class AppErrorHandler {
  static install(app) {
    // Global error handler
    app.config.errorHandler = (error, instance, info) => {
      console.error('Global error:', error)
      console.error('Component instance:', instance)
      console.error('Error info:', info)
      
      // Prevent app crashes by catching errors
      if (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk')) {
        // Handle chunk loading errors (common in production builds)
        window.location.reload()
        return
      }
      
      // Log to external service if needed
      // this.logError(error, instance, info)
    }
    
    // Handle unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      console.error('Unhandled promise rejection:', event.reason)
      event.preventDefault() // Prevent the default browser behavior
    })
    
    // Handle general errors
    window.addEventListener('error', (event) => {
      console.error('Global error event:', event.error)
      event.preventDefault()
    })
  }
  
  static logError(error, instance, info) {
    // Implement error logging to external service
    console.log('Logging error to external service:', { error, instance, info })
  }
}

// Safe async wrapper
export const safeAsync = (fn) => {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (error) {
      console.error('Async operation failed:', error)
      throw error
    }
  }
}

// Safe component method wrapper
export const safeMixin = {
  methods: {
    safeCall(fn, ...args) {
      try {
        return fn.call(this, ...args)
      } catch (error) {
        console.error('Method call failed:', error)
        if (this.$q && this.$q.notify) {
          this.$q.notify({
            type: 'negative',
            message: 'An error occurred. Please try again.',
            position: 'bottom'
          })
        }
      }
    }
  }
}
