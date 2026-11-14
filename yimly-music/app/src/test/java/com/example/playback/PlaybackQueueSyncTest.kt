package com.example.playback

import androidx.media3.common.MediaItem
import com.example.data.models.Song
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PlaybackQueueSyncTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private val testScope = TestScope(testDispatcher)
    private val syncListener = object : QueueMediaSyncListener {
        override fun onMediaItemAdded(index: Int, mediaItem: MediaItem) {}
        override fun onMediaItemRemoved(index: Int) {}
        override fun onMediaItemMoved(fromIndex: Int, toIndex: Int) {}
        override fun onQueueCleared() {}
    }

    private lateinit var manager: PlaybackQueueManager

    @Before
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        manager = PlaybackQueueManager(
            coroutineScope = testScope,
            mediaItemBuilder = { song, _ -> MediaItem.Builder().setMediaId(song.id).build() },
            syncListener = syncListener,
            ioDispatcher = testDispatcher,
            mainDispatcher = testDispatcher
        )
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createSong(id: String) = Song(id = id, title = "Title $id", artist = "Artist $id")

    @Test
    fun `syncCurrentEntryFromPlayer updates current entry on natural transition`() {
        val songs = listOf(createSong("1"), createSong("2"), createSong("3"))
        manager.updateQueueState(songs, 0)
        val id2 = manager.queueState.value.entries[1].entryId

        val changed = manager.syncCurrentEntryFromPlayer(1, "2")
        
        assertTrue(changed)
        assertEquals(id2, manager.queueState.value.currentEntryId)
        assertEquals(1, manager.currentQueueIndex.value)
    }

    @Test
    fun `syncCurrentEntryFromPlayer ignore stale transition with mismatched mediaId`() {
        val songs = listOf(createSong("1"), createSong("2"), createSong("3"))
        manager.updateQueueState(songs, 0)
        val id1 = manager.queueState.value.entries[0].entryId

        // Player reports index 1 but mediaId "3" (which is index 2)
        val changed = manager.syncCurrentEntryFromPlayer(1, "3")
        
        assertFalse(changed)
        assertEquals(id1, manager.queueState.value.currentEntryId)
    }

    @Test
    fun `syncCurrentEntryFromPlayer no-op when entry is already correct`() {
        val songs = listOf(createSong("1"), createSong("2"))
        manager.updateQueueState(songs, 1)
        val initialRev = manager.queueState.value.revision

        val changed = manager.syncCurrentEntryFromPlayer(1, "2")
        
        assertFalse(changed)
        assertEquals(initialRev, manager.queueState.value.revision)
    }

    @Test
    fun `syncCurrentEntryFromPlayer resolves duplicate song IDs using index`() {
        val songs = listOf(createSong("1"), createSong("2"), createSong("1"))
        manager.updateQueueState(songs, 0)
        val id1a = manager.queueState.value.entries[0].entryId
        val id1b = manager.queueState.value.entries[2].entryId

        // Transition to the second instance of song "1" at index 2
        val changed = manager.syncCurrentEntryFromPlayer(2, "1")
        
        assertTrue(changed)
        assertEquals(id1b, manager.queueState.value.currentEntryId)
        
        // Transition back to the first instance at index 0
        val changed2 = manager.syncCurrentEntryFromPlayer(0, "1")
        assertTrue(changed2)
        assertEquals(id1a, manager.queueState.value.currentEntryId)
    }

    @Test
    fun `syncCurrentEntryFromPlayer handles instrumental mediaId correctly`() {
        val songs = listOf(createSong("1"), createSong("2"))
        manager.updateQueueState(songs, 0)
        val id2 = manager.queueState.value.entries[1].entryId

        // Player transitioned to instrumental version of song 2
        val changed = manager.syncCurrentEntryFromPlayer(1, "2_inst")
        
        assertTrue(changed)
        assertEquals(id2, manager.queueState.value.currentEntryId)
    }

    @Test
    fun `syncCurrentEntryFromPlayer safely ignores out of bounds index`() {
        val songs = listOf(createSong("1"))
        manager.updateQueueState(songs, 0)
        
        val changed = manager.syncCurrentEntryFromPlayer(5, "1")
        assertFalse(changed)
    }

    @Test
    fun `syncCurrentEntryFromPlayer ignores null mediaId`() {
        val songs = listOf(createSong("1"))
        manager.updateQueueState(songs, 0)
        
        val changed = manager.syncCurrentEntryFromPlayer(0, null)
        assertFalse(changed)
    }

    @Test
    fun `syncCurrentEntryFromPlayer ignores empty mediaId`() {
        val songs = listOf(createSong("1"))
        manager.updateQueueState(songs, 0)
        
        val changed = manager.syncCurrentEntryFromPlayer(0, "")
        assertFalse(changed)
    }

    @Test
    fun `syncCurrentEntryFromPlayer ignores negative index`() {
        val songs = listOf(createSong("1"))
        manager.updateQueueState(songs, 0)
        
        val changed = manager.syncCurrentEntryFromPlayer(-1, "1")
        assertFalse(changed)
    }

    @Test
    fun `syncCurrentEntryFromPlayer does not mutate shuffle history`() {
        val songs = listOf(createSong("1"), createSong("2"), createSong("3"))
        manager.updateQueueState(songs, 0)
        manager.restoreShuffleHistory(listOf(0))
        val initialHistory = manager.queueState.value.shuffleHistory
        assertEquals(1, initialHistory.size)

        val changed = manager.syncCurrentEntryFromPlayer(1, "2")
        assertTrue(changed)
        assertEquals(initialHistory, manager.queueState.value.shuffleHistory)
    }

    @Test
    fun `syncCurrentEntryFromPlayer does not invoke QueueMediaSyncListener methods`() {
        var listenerCalls = 0
        val recordingListener = object : QueueMediaSyncListener {
            override fun onMediaItemAdded(index: Int, mediaItem: MediaItem) { listenerCalls++ }
            override fun onMediaItemRemoved(index: Int) { listenerCalls++ }
            override fun onMediaItemMoved(fromIndex: Int, toIndex: Int) { listenerCalls++ }
            override fun onQueueCleared() { listenerCalls++ }
        }

        val testManager = PlaybackQueueManager(
            coroutineScope = testScope,
            mediaItemBuilder = { song, _ -> MediaItem.Builder().setMediaId(song.id).build() },
            syncListener = recordingListener,
            ioDispatcher = testDispatcher,
            mainDispatcher = testDispatcher
        )
        val songs = listOf(createSong("1"), createSong("2"))
        testManager.updateQueueState(songs, 0)
        listenerCalls = 0 // reset calls from setup

        val changed = testManager.syncCurrentEntryFromPlayer(1, "2")
        assertTrue(changed)
        assertEquals(0, listenerCalls)
    }

    @Test
    fun `syncCurrentEntryFromPlayer handles empty queue safely`() {
        val changed = manager.syncCurrentEntryFromPlayer(0, "1")
        assertFalse(changed)
    }

    @Test
    fun `stale or no-op transition does not trigger queueChangeListener or increment revision`() = runTest {
        var listenerFired = false
        val managerWithListener = PlaybackQueueManager(
            coroutineScope = testScope,
            mediaItemBuilder = { song, _ -> MediaItem.Builder().setMediaId(song.id).build() },
            syncListener = syncListener,
            ioDispatcher = testDispatcher,
            mainDispatcher = testDispatcher,
            queueChangeListener = { listenerFired = true }
        )
        val songs = listOf(createSong("1"), createSong("2"))
        managerWithListener.updateQueueState(songs, 0)
        val baselineRev = managerWithListener.queueState.value.revision
        listenerFired = false

        // Repeated transition for already active item 0
        val noOpChanged = managerWithListener.syncCurrentEntryFromPlayer(0, "1")
        assertFalse(noOpChanged)
        assertFalse(listenerFired)
        assertEquals(baselineRev, managerWithListener.queueState.value.revision)

        // Stale transition with mismatched mediaId
        val staleChanged = managerWithListener.syncCurrentEntryFromPlayer(1, "wrong_id")
        assertFalse(staleChanged)
        assertFalse(listenerFired)
        assertEquals(baselineRev, managerWithListener.queueState.value.revision)

        // Out of bounds transition
        val oobChanged = managerWithListener.syncCurrentEntryFromPlayer(99, "1")
        assertFalse(oobChanged)
        assertFalse(listenerFired)
        assertEquals(baselineRev, managerWithListener.queueState.value.revision)
    }

    @Test
    fun `sync triggers queueChangeListener for real metadata changes`() = runTest {
        var notifiedState: QueueState? = null
        val managerWithListener = PlaybackQueueManager(
            coroutineScope = testScope,
            mediaItemBuilder = { song, _ -> MediaItem.Builder().setMediaId(song.id).build() },
            syncListener = syncListener,
            ioDispatcher = testDispatcher,
            mainDispatcher = testDispatcher,
            queueChangeListener = { notifiedState = it }
        )
        val songs = listOf(createSong("1"), createSong("2"))
        managerWithListener.updateQueueState(songs, 0)
        val revAfterUpdate = managerWithListener.queueState.value.revision
        
        // Natural transition to item 2
        managerWithListener.syncCurrentEntryFromPlayer(1, "2")
        
        assertNotNull(notifiedState)
        assertEquals(revAfterUpdate + 1, notifiedState?.revision)
        assertEquals(managerWithListener.queueState.value.entries[1].entryId, notifiedState?.currentEntryId)
    }
}
